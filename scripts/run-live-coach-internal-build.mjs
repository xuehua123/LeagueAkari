import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const yarnCli = resolve('.yarn/releases/yarn-4.9.1.cjs')
const buildEnvironment = {
  ...process.env,
  LIVE_COACH_BUILD_CHANNEL: 'internal'
}

function buildFailure(message, exitCode = 1) {
  const error = new Error(message)
  error.exitCode = exitCode
  return error
}

function runYarnScript(script) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [yarnCli, script], {
      cwd: process.cwd(),
      env: buildEnvironment,
      stdio: 'inherit'
    })

    child.once('error', (error) => {
      rejectRun(buildFailure(`Failed to start ${script}: ${error.message}`))
    })
    child.once('exit', (code, signal) => {
      if (signal) {
        rejectRun(buildFailure(`${script} terminated by ${signal}`))
        return
      }
      if (code !== 0) {
        rejectRun(
          buildFailure(`${script} exited with code ${code ?? 'unknown'}`, code ?? undefined)
        )
        return
      }
      resolveRun()
    })
  })
}

try {
  await runYarnScript('build:win:native')
  await runYarnScript('smoke:packaged-runtime')
} catch (error) {
  console.error(`Internal Windows build gate failed: ${error.message}`)
  process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 1
}
