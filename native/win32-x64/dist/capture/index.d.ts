import type { NativeCaptureSessionBinding, NativeCaptureSessionOptions, NativeCaptureTargetEnvironment, NativeCaptureTargetOptions, NativeCapturedFrame } from '../bindings';
export type { NativeCapturedFrame, NativeCaptureSessionOptions, NativeCaptureTargetEnvironment, NativeCaptureTargetOptions };
export declare function load(): void;
export declare function isLoaded(): boolean;
export declare function isWgcSupported(): boolean;
export declare function isDdaSupported(): boolean;
export declare function inspectTargetEnvironment(options: NativeCaptureTargetOptions): NativeCaptureTargetEnvironment | null;
export declare class CaptureSession implements NativeCaptureSessionBinding {
    private readonly _binding;
    constructor(options: NativeCaptureSessionOptions);
    captureFrame(timeoutMs?: number): NativeCapturedFrame | null;
    dispose(): void;
}
