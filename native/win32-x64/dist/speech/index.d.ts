import type { NativeSpeechOperationState, NativeSpeechOptions, NativeSpeechOutputDevice, NativeSpeechSynthesizerBinding, NativeSpeechVoice } from '../bindings';
export type { NativeSpeechOperationState, NativeSpeechOptions, NativeSpeechOutputDevice, NativeSpeechVoice };
export declare function load(): void;
export declare function isLoaded(): boolean;
export declare function playEarcon(category: string, volume: number): Promise<boolean>;
export declare class SpeechSynthesizer implements NativeSpeechSynthesizerBinding {
    private readonly _binding;
    constructor();
    listVoices(): NativeSpeechVoice[];
    listOutputDevices(): NativeSpeechOutputDevice[];
    speak(text: string, options: NativeSpeechOptions): string;
    getOperationState(operationId: string): NativeSpeechOperationState;
    cancel(operationId?: string): boolean;
    pause(): boolean;
    resume(): boolean;
    dispose(): void;
}
