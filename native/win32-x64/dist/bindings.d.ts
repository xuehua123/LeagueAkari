export interface NativeKeyState {
    vkCode: number;
    pressed: boolean;
    scanCode: number;
}
export type NativeKeyEventCallback = (rawEvent: string) => void;
export interface AkariInputBinding {
    install(): void;
    uninstall(): void;
    onKeyEvent(callback: NativeKeyEventCallback): void;
    sendString(text: string): Promise<void>;
    sendKey(virtualKeyCode: number, pressed: boolean): Promise<void>;
    getKeyStates(): NativeKeyState[];
}
export interface FixLeagueClientWindowConfig {
    baseWidth?: number;
    baseHeight?: number;
}
export interface LeagueClientWindowPlacementInfo {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    shownState: number;
    isMinimized: boolean;
    isMaximized: boolean;
    isNormal: boolean;
}
export interface AkariToolsBinding {
    fixWindowMethodA(clientZoom: number, config: FixLeagueClientWindowConfig): boolean | null;
    isElevated(): boolean;
    getLeagueClientWindowPlacementInfo(): LeagueClientWindowPlacementInfo | null;
    getCommandLine1(pid: number): string;
    getPidsByName(processName: string): number[];
    terminateProcess(pid: number): boolean;
    isProcessForeground(pid: number): boolean;
    isProcessRunning(pid: number): boolean;
}
export type NativeCaptureBackend = 'wgc' | 'dda';
export interface NativeCaptureSessionOptions {
    backend: NativeCaptureBackend;
    targetHwnd?: number | bigint | null;
    targetPid?: number | null;
    roi: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}
export interface NativeCapturedFrame {
    buffer: Buffer;
    width: number;
    height: number;
    sourceWidth: number;
    sourceHeight: number;
    pixelFormat: 'bgra';
    backend: NativeCaptureBackend;
    hdr: boolean;
    observedAt: number;
}
export interface NativeCaptureTargetOptions {
    targetHwnd?: number | bigint | null;
    targetPid?: number | null;
}
export interface NativeCaptureTargetEnvironment {
    targetPid: number;
    displayId: string;
    windowBounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    clientBounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    monitorBounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    dpiScale: number | null;
    hdr: boolean | null;
    windowMode: 'windowed' | 'borderless' | 'exclusive-fullscreen' | 'unknown';
}
export interface NativeCaptureSessionBinding {
    captureFrame(timeoutMs?: number): NativeCapturedFrame | null;
    dispose(): void;
}
export interface AkariCaptureBinding {
    CaptureSession: new (options: NativeCaptureSessionOptions) => NativeCaptureSessionBinding;
    isWgcSupported(): boolean;
    isDdaSupported(): boolean;
    inspectTargetEnvironment(options: NativeCaptureTargetOptions): NativeCaptureTargetEnvironment | null;
}
export interface NativeSpeechVoice {
    id: string;
    name: string;
    culture: string;
    gender: string;
}
export interface NativeSpeechOutputDevice {
    id: string;
    name: string;
    isDefault: boolean;
}
export interface NativeSpeechOptions {
    voiceId?: string | null;
    outputDeviceId?: string | null;
    volume: number;
    rate: number;
}
export type NativeSpeechOperationState = 'speaking' | 'paused' | 'completed' | 'cancelled' | 'failed' | 'unknown';
export interface NativeSpeechSynthesizerBinding {
    listVoices(): NativeSpeechVoice[];
    listOutputDevices(): NativeSpeechOutputDevice[];
    speak(text: string, options: NativeSpeechOptions): string;
    getOperationState(operationId: string): NativeSpeechOperationState;
    cancel(operationId?: string): boolean;
    pause(): boolean;
    resume(): boolean;
    dispose(): void;
}
export interface AkariSpeechBinding {
    SpeechSynthesizer: new () => NativeSpeechSynthesizerBinding;
    playEarcon(category: string, volume: number): Promise<boolean>;
}
