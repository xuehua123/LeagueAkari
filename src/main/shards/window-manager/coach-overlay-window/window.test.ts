import { GameClientMain } from '@main/shards/game-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { shouldShowCoachOverlay } from '../../live-coach/overlay-visibility'
import { AkariCoachOverlayWindow } from './window'

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: false
  }
}))

vi.mock('@main/i18n', () => ({
  i18next: {
    t: (key: string) => key
  }
}))

vi.mock('@main/native', () => ({
  NATIVE_SUPPORT: {
    nativeInput: {
      available: false,
      availableOnCurrentPlatform: true,
      requiresElevation: true
    }
  },
  nativeInput: {
    instance: {},
    VKEY_MAP: {},
    UNIFIED_KEY_ID: {},
    isModifierKey: vi.fn()
  }
}))

vi.mock('@main/shards/game-client', () => ({
  GameClientMain: {
    isGameClientForeground: vi.fn()
  }
}))

vi.mock('@resources/LA_ICON.ico?asset', () => ({
  default: 'akari-icon.ico'
}))

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  app: {
    getPath: vi.fn()
  },
  dialog: {
    showMessageBox: vi.fn()
  },
  shell: {
    openExternal: vi.fn()
  }
}))

function createContext() {
  const mainWindowWebContents = {}
  const settingService = {
    applyToState: vi.fn(),
    _getFromStorage: vi.fn(),
    _saveToStorage: vi.fn()
  }
  const context = {
    namespace: 'window-manager-main',
    windowManager: {
      settings: { contentProtection: false },
      state: { isManagerFinishedInit: true },
      mainWindow: {
        window: { webContents: mainWindowWebContents }
      }
    },
    settingFactory: {
      register: vi.fn(() => settingService)
    },
    loggerFactory: {
      create: vi.fn(() => ({
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      }))
    },
    mobxUtils: {
      reaction: vi.fn(
        (
          getter: () => unknown,
          effect: (value: unknown) => void,
          options?: { fireImmediately?: boolean }
        ) => {
          if (options?.fireImmediately) effect(getter())
        }
      ),
      propSync: vi.fn()
    },
    protocol: { registerPartition: vi.fn() },
    keyboardShortcuts: { register: vi.fn(), unregisterByTargetId: vi.fn() },
    ipc: { onCall: vi.fn() },
    shared: { global: { isReadyToQuit: false } },
    appCommon: {},
    leagueClient: {},
    gameClient: {}
  }

  return context
}

function createWindowDouble() {
  return {
    webContents: {},
    isDestroyed: vi.fn(() => false),
    setSkipTaskbar: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setFocusable: vi.fn(),
    setMovable: vi.fn(),
    setResizable: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    focus: vi.fn(),
    show: vi.fn()
  }
}

describe('AkariCoachOverlayWindow interaction mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(GameClientMain.isGameClientForeground).mockResolvedValue(false)
  })

  it('keeps the shortcut path gated by the foreground game', async () => {
    const overlayWindow = new AkariCoachOverlayWindow(createContext() as any)

    await expect(overlayWindow.setInteractionMode(true)).resolves.toBe(false)

    expect(overlayWindow.state.interactive).toBe(false)
  })

  it('registers a trusted UI path that enters adjustment and restores passthrough', async () => {
    const context = createContext()
    const overlayWindow = new AkariCoachOverlayWindow(context as any)
    vi.spyOn(overlayWindow, 'createWindow').mockImplementation(() => {})
    await overlayWindow.onInit()

    const nativeWindow = createWindowDouble()
    ;(overlayWindow as any)._window = nativeWindow
    overlayWindow.settings.setLocked(false)
    const interactionHandler = context.ipc.onCall.mock.calls.find(
      ([namespace, name]) =>
        namespace === 'window-manager-main/coach-overlay-window' && name === 'setInteractionMode'
    )?.[2]

    expect(interactionHandler).toBeTypeOf('function')
    await expect(
      interactionHandler({ sender: context.windowManager.mainWindow.window.webContents }, true)
    ).resolves.toBe(true)
    expect(GameClientMain.isGameClientForeground).not.toHaveBeenCalled()
    expect(overlayWindow.state.interactive).toBe(true)
    expect(nativeWindow.setMovable).toHaveBeenLastCalledWith(true)
    expect(nativeWindow.setResizable).toHaveBeenLastCalledWith(true)
    expect(nativeWindow.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })

    await expect(interactionHandler({ sender: nativeWindow.webContents }, false)).resolves.toBe(
      true
    )
    expect(overlayWindow.state.interactive).toBe(false)
    expect(nativeWindow.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })

    await expect(
      interactionHandler({ sender: context.windowManager.mainWindow.window.webContents }, false)
    ).resolves.toBe(true)
  })

  it('rejects malformed or unauthorized interaction changes without mutating state', async () => {
    const context = createContext()
    const overlayWindow = new AkariCoachOverlayWindow(context as any)
    vi.spyOn(overlayWindow, 'createWindow').mockImplementation(() => {})
    await overlayWindow.onInit()

    const nativeWindow = createWindowDouble()
    ;(overlayWindow as any)._window = nativeWindow
    const interactionHandler = context.ipc.onCall.mock.calls.find(
      ([namespace, name]) =>
        namespace === 'window-manager-main/coach-overlay-window' && name === 'setInteractionMode'
    )?.[2]

    await expect(
      Promise.resolve().then(() => interactionHandler({ sender: nativeWindow.webContents }, true))
    ).rejects.toMatchObject({ code: 'CoachOverlayInteractionModeSenderNotAllowed' })
    expect(overlayWindow.state.interactive).toBe(false)

    overlayWindow.state.setInteractive(true)
    await expect(
      Promise.resolve().then(() => interactionHandler({ sender: {} }, false))
    ).rejects.toMatchObject({ code: 'CoachOverlayInteractionModeSenderNotAllowed' })
    expect(overlayWindow.state.interactive).toBe(true)

    await expect(
      Promise.resolve().then(() =>
        interactionHandler({ sender: context.windowManager.mainWindow.window.webContents }, 'false')
      )
    ).rejects.toMatchObject({ code: 'CoachOverlayInteractionModeInvalid' })
    expect(overlayWindow.state.interactive).toBe(true)
  })
})

describe('coach overlay visibility while adjusting', () => {
  it('shows once an idle interactive overlay becomes ready', () => {
    const snapshot = {
      coachEnabled: false,
      overlayEnabled: false,
      overlayInteractive: true,
      sessionState: 'idle' as const,
      windowReady: false
    }

    expect(shouldShowCoachOverlay(snapshot)).toBe(false)
    expect(shouldShowCoachOverlay({ ...snapshot, windowReady: true })).toBe(true)
  })

  it('does not interrupt adjustment when an active session becomes idle', () => {
    const snapshot = {
      coachEnabled: true,
      overlayEnabled: true,
      overlayInteractive: true,
      sessionState: 'active' as const,
      windowReady: true
    }

    expect(shouldShowCoachOverlay(snapshot)).toBe(true)
    expect(shouldShowCoachOverlay({ ...snapshot, sessionState: 'idle' })).toBe(true)
  })

  it('hides an idle overlay after adjustment becomes non-interactive', () => {
    const snapshot = {
      coachEnabled: true,
      overlayEnabled: true,
      overlayInteractive: true,
      sessionState: 'idle' as const,
      windowReady: true
    }

    expect(shouldShowCoachOverlay(snapshot)).toBe(true)
    expect(shouldShowCoachOverlay({ ...snapshot, overlayInteractive: false })).toBe(false)
  })
})
