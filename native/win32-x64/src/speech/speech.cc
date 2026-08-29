#include <napi.h>

#include <Windows.h>
#include <sapi.h>
#include <mmsystem.h>
#include <wrl/client.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cwchar>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {

void CheckHresult(HRESULT result, const char* operation) {
  if (SUCCEEDED(result)) return;
  std::ostringstream message;
  message << operation << " failed (HRESULT 0x" << std::hex << std::uppercase
          << static_cast<uint32_t>(result) << ')';
  throw std::runtime_error(message.str());
}

std::wstring FromJsString(const Napi::Value& value) {
  const std::u16string utf16 = value.As<Napi::String>().Utf16Value();
  return std::wstring(utf16.begin(), utf16.end());
}

Napi::String ToJsString(Napi::Env env, const std::wstring& value) {
  return Napi::String::New(env, std::u16string(value.begin(), value.end()));
}

std::wstring ReadTokenId(ISpObjectToken* token) {
  LPWSTR raw = nullptr;
  CheckHresult(token->GetId(&raw), "Read SAPI token id");
  std::wstring value = raw ? raw : L"";
  CoTaskMemFree(raw);
  return value;
}

std::wstring ReadTokenAttribute(ISpObjectToken* token, const wchar_t* key) {
  ComPtr<ISpDataKey> attributes;
  if (FAILED(token->OpenKey(L"Attributes", &attributes)) || !attributes) return L"";
  LPWSTR raw = nullptr;
  if (FAILED(attributes->GetStringValue(key, &raw))) return L"";
  std::wstring value = raw ? raw : L"";
  CoTaskMemFree(raw);
  return value;
}

std::wstring ReadTokenDescription(ISpObjectToken* token) {
  LPWSTR raw = nullptr;
  if (FAILED(token->GetStringValue(nullptr, &raw)) || !raw) return ReadTokenId(token);
  std::wstring value = raw;
  CoTaskMemFree(raw);
  return value;
}

std::wstring CultureFromLanguageAttribute(const std::wstring& language) {
  if (language.empty()) return L"unknown";
  const size_t separator = language.find(L';');
  const std::wstring primary = language.substr(0, separator);
  wchar_t* end = nullptr;
  const unsigned long languageId = std::wcstoul(primary.c_str(), &end, 16);
  if (end == primary.c_str() || languageId > 0xffff) return L"unknown";
  wchar_t localeName[LOCALE_NAME_MAX_LENGTH]{};
  if (!LCIDToLocaleName(MAKELCID(static_cast<LANGID>(languageId), SORT_DEFAULT), localeName,
                        LOCALE_NAME_MAX_LENGTH, 0)) {
    return L"unknown";
  }
  return localeName;
}

ComPtr<ISpObjectTokenCategory> OpenCategory(const wchar_t* categoryId) {
  ComPtr<ISpObjectTokenCategory> category;
  CheckHresult(CoCreateInstance(CLSID_SpObjectTokenCategory, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(&category)),
               "Create SAPI token category");
  CheckHresult(category->SetId(categoryId, FALSE), "Open SAPI token category");
  return category;
}

ComPtr<ISpObjectToken> OpenToken(const std::wstring& tokenId) {
  ComPtr<ISpObjectToken> token;
  CheckHresult(CoCreateInstance(CLSID_SpObjectToken, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(&token)),
               "Create SAPI token");
  CheckHresult(token->SetId(nullptr, tokenId.c_str(), FALSE), "Open SAPI token");
  return token;
}

ComPtr<IEnumSpObjectTokens> EnumerateCategory(const wchar_t* categoryId) {
  const auto category = OpenCategory(categoryId);
  ComPtr<IEnumSpObjectTokens> tokens;
  CheckHresult(category->EnumTokens(nullptr, nullptr, &tokens), "Enumerate SAPI tokens");
  return tokens;
}

class EarconWorker : public Napi::AsyncWorker {
 public:
  EarconWorker(Napi::Env env, std::string category, double volume)
      : Napi::AsyncWorker(env),
        deferred_(Napi::Promise::Deferred::New(env)),
        category_(std::move(category)),
        volume_(std::clamp(volume, 0.0, 1.0)) {}

  Napi::Promise Promise() const { return deferred_.Promise(); }

  void Execute() override {
    if (volume_ <= 0.0) return;

    constexpr uint32_t sampleRate = 44100;
    const double frequency = category_ == "warning"     ? 880.0
                             : category_ == "opportunity" ? 660.0
                                                           : 440.0;
    const uint32_t durationMs = category_ == "warning"     ? 140
                                : category_ == "opportunity" ? 110
                                                              : 80;
    const size_t sampleCount = static_cast<size_t>(sampleRate) * durationMs / 1000;
    samples_.resize(sampleCount);
    constexpr double pi = 3.14159265358979323846;
    const size_t fadeSamples = std::max<size_t>(1, sampleRate / 200);
    for (size_t index = 0; index < sampleCount; ++index) {
      const double fadeIn = std::min(1.0, static_cast<double>(index) / fadeSamples);
      const double fadeOut =
          std::min(1.0, static_cast<double>(sampleCount - 1 - index) / fadeSamples);
      const double envelope = std::min(fadeIn, fadeOut);
      const double sample = std::sin(2.0 * pi * frequency * index / sampleRate);
      samples_[index] = static_cast<int16_t>(
          std::clamp(sample * envelope * volume_ * 12000.0, -32767.0, 32767.0));
    }

    WAVEFORMATEX format{};
    format.wFormatTag = WAVE_FORMAT_PCM;
    format.nChannels = 1;
    format.nSamplesPerSec = sampleRate;
    format.wBitsPerSample = 16;
    format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
    format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;

    MMRESULT result = waveOutOpen(&output_, WAVE_MAPPER, &format, 0, 0, CALLBACK_NULL);
    if (result != MMSYSERR_NOERROR) {
      SetError("Unable to open the default Windows audio output");
      Cleanup();
      return;
    }
    header_.lpData = reinterpret_cast<LPSTR>(samples_.data());
    header_.dwBufferLength = static_cast<DWORD>(samples_.size() * sizeof(int16_t));
    result = waveOutPrepareHeader(output_, &header_, sizeof(header_));
    if (result != MMSYSERR_NOERROR) {
      SetError("Unable to prepare the earcon audio buffer");
      Cleanup();
      return;
    }
    prepared_ = true;
    result = waveOutWrite(output_, &header_, sizeof(header_));
    const ULONGLONG timeoutAt = GetTickCount64() + 1000;
    while (result == MMSYSERR_NOERROR && !(header_.dwFlags & WHDR_DONE) &&
           GetTickCount64() < timeoutAt) {
      Sleep(5);
    }
    if (result != MMSYSERR_NOERROR || !(header_.dwFlags & WHDR_DONE)) {
      SetError("Unable to complete earcon playback");
    } else {
      played_ = true;
    }
    Cleanup();
  }

  void OnOK() override { deferred_.Resolve(Napi::Boolean::New(Env(), played_)); }

  void OnError(const Napi::Error&) override {
    deferred_.Resolve(Napi::Boolean::New(Env(), false));
  }

 private:
  void Cleanup() {
    if (output_) {
      waveOutReset(output_);
      if (prepared_) waveOutUnprepareHeader(output_, &header_, sizeof(header_));
      waveOutClose(output_);
      output_ = nullptr;
      prepared_ = false;
    }
  }

  Napi::Promise::Deferred deferred_;
  std::string category_;
  double volume_;
  std::vector<int16_t> samples_;
  HWAVEOUT output_ = nullptr;
  WAVEHDR header_{};
  bool prepared_ = false;
  bool played_ = false;
};

Napi::Value PlayEarcon(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "Earcon category and volume are required")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  auto* worker = new EarconWorker(env, info[0].As<Napi::String>().Utf8Value(),
                                  info[1].As<Napi::Number>().DoubleValue());
  const Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

std::wstring DefaultTokenId(const wchar_t* categoryId) {
  const auto category = OpenCategory(categoryId);
  LPWSTR raw = nullptr;
  if (FAILED(category->GetDefaultTokenId(&raw)) || !raw) return L"";
  std::wstring value = raw;
  CoTaskMemFree(raw);
  return value;
}

class SpeechSynthesizerWrap : public Napi::ObjectWrap<SpeechSynthesizerWrap> {
 public:
  static Napi::FunctionReference constructor;

  explicit SpeechSynthesizerWrap(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<SpeechSynthesizerWrap>(info) {
    Napi::Env env = info.Env();
    try {
      const HRESULT apartmentResult = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
      if (FAILED(apartmentResult) && apartmentResult != RPC_E_CHANGED_MODE) {
        CheckHresult(apartmentResult, "Initialize COM for SAPI");
      }
      comInitialized_ = SUCCEEDED(apartmentResult);
      CheckHresult(CoCreateInstance(CLSID_SpVoice, nullptr, CLSCTX_INPROC_SERVER,
                                    IID_PPV_ARGS(&voice_)),
                   "Create SAPI voice");
    } catch (const std::exception& error) {
      DisposeNative();
      Napi::Error::New(env, error.what()).ThrowAsJavaScriptException();
    }
  }

  ~SpeechSynthesizerWrap() override { DisposeNative(); }

  Napi::Value ListVoices(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
      EnsureAvailable();
      const auto tokens = EnumerateCategory(SPCAT_VOICES);
      ULONG count = 0;
      CheckHresult(tokens->GetCount(&count), "Count SAPI voices");
      Napi::Array result = Napi::Array::New(env, count);
      for (ULONG index = 0; index < count; ++index) {
        ComPtr<ISpObjectToken> token;
        CheckHresult(tokens->Item(index, &token), "Read SAPI voice");
        Napi::Object item = Napi::Object::New(env);
        item.Set("id", ToJsString(env, ReadTokenId(token.Get())));
        item.Set("name", ToJsString(env, ReadTokenDescription(token.Get())));
        item.Set("culture",
                 ToJsString(env, CultureFromLanguageAttribute(
                                     ReadTokenAttribute(token.Get(), L"Language"))));
        const std::wstring gender = ReadTokenAttribute(token.Get(), L"Gender");
        item.Set("gender", ToJsString(env, gender.empty() ? L"Unknown" : gender));
        result.Set(index, item);
      }
      return result;
    } catch (const std::exception& error) {
      Napi::Error::New(env, error.what()).ThrowAsJavaScriptException();
      return env.Null();
    }
  }

  Napi::Value ListOutputDevices(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
      EnsureAvailable();
      const auto tokens = EnumerateCategory(SPCAT_AUDIOOUT);
      const std::wstring defaultId = DefaultTokenId(SPCAT_AUDIOOUT);
      ULONG count = 0;
      CheckHresult(tokens->GetCount(&count), "Count SAPI output devices");
      Napi::Array result = Napi::Array::New(env, count);
      for (ULONG index = 0; index < count; ++index) {
        ComPtr<ISpObjectToken> token;
        CheckHresult(tokens->Item(index, &token), "Read SAPI output device");
        const std::wstring id = ReadTokenId(token.Get());
        Napi::Object item = Napi::Object::New(env);
        item.Set("id", ToJsString(env, id));
        item.Set("name", ToJsString(env, ReadTokenDescription(token.Get())));
        item.Set("isDefault", Napi::Boolean::New(env, id == defaultId));
        result.Set(index, item);
      }
      return result;
    } catch (const std::exception& error) {
      Napi::Error::New(env, error.what()).ThrowAsJavaScriptException();
      return env.Null();
    }
  }

  Napi::Value Speak(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
      EnsureAvailable();
      if (info.Length() < 2 || !info[0].IsString() || !info[1].IsObject()) {
        throw std::invalid_argument("Speech text and options are required");
      }
      const std::wstring text = FromJsString(info[0]);
      if (text.empty()) throw std::invalid_argument("Speech text cannot be empty");
      const Napi::Object options = info[1].As<Napi::Object>();
      CancelInternal();
      ConfigureVoice(options);

      const int volume = options.Has("volume") && options.Get("volume").IsNumber()
                             ? options.Get("volume").As<Napi::Number>().Int32Value()
                             : 80;
      const int rate = options.Has("rate") && options.Get("rate").IsNumber()
                           ? options.Get("rate").As<Napi::Number>().Int32Value()
                           : 0;
      CheckHresult(voice_->SetVolume(static_cast<USHORT>(std::clamp(volume, 0, 100))),
                   "Set SAPI volume");
      CheckHresult(voice_->SetRate(std::clamp(rate, -10, 10)), "Set SAPI rate");

      ULONG streamNumber = 0;
      CheckHresult(voice_->Speak(text.c_str(), SPF_ASYNC | SPF_PURGEBEFORESPEAK | SPF_IS_NOT_XML,
                                 &streamNumber),
                   "Start SAPI speech");
      currentOperationId_ = "sapi-" + std::to_string(++operationCounter_) + "-" +
                            std::to_string(streamNumber);
      currentState_ = "speaking";
      operationStates_[currentOperationId_] = currentState_;
      return Napi::String::New(env, currentOperationId_);
    } catch (const std::exception& error) {
      currentState_ = "failed";
      if (!currentOperationId_.empty()) operationStates_[currentOperationId_] = currentState_;
      Napi::Error::New(env, error.what()).ThrowAsJavaScriptException();
      return env.Null();
    }
  }

  Napi::Value GetOperationState(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
      EnsureAvailable();
      if (!info.Length() || !info[0].IsString()) {
        throw std::invalid_argument("Speech operation id is required");
      }
      const std::string operationId = info[0].As<Napi::String>().Utf8Value();
      RefreshState();
      const auto found = operationStates_.find(operationId);
      return Napi::String::New(env, found == operationStates_.end() ? "unknown" : found->second);
    } catch (const std::exception& error) {
      Napi::Error::New(env, error.what()).ThrowAsJavaScriptException();
      return env.Null();
    }
  }

  Napi::Value Cancel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
      EnsureAvailable();
      if (info.Length() && info[0].IsString() &&
          info[0].As<Napi::String>().Utf8Value() != currentOperationId_) {
        return Napi::Boolean::New(env, false);
      }
      return Napi::Boolean::New(env, CancelInternal());
    } catch (const std::exception& error) {
      Napi::Error::New(env, error.what()).ThrowAsJavaScriptException();
      return Napi::Boolean::New(env, false);
    }
  }

  Napi::Value Pause(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
      EnsureAvailable();
      if (currentState_ != "speaking") return Napi::Boolean::New(env, false);
      CheckHresult(voice_->Pause(), "Pause SAPI speech");
      currentState_ = "paused";
      operationStates_[currentOperationId_] = currentState_;
      return Napi::Boolean::New(env, true);
    } catch (const std::exception& error) {
      Napi::Error::New(env, error.what()).ThrowAsJavaScriptException();
      return Napi::Boolean::New(env, false);
    }
  }

  Napi::Value Resume(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
      EnsureAvailable();
      if (currentState_ != "paused") return Napi::Boolean::New(env, false);
      CheckHresult(voice_->Resume(), "Resume SAPI speech");
      currentState_ = "speaking";
      operationStates_[currentOperationId_] = currentState_;
      return Napi::Boolean::New(env, true);
    } catch (const std::exception& error) {
      Napi::Error::New(env, error.what()).ThrowAsJavaScriptException();
      return Napi::Boolean::New(env, false);
    }
  }

  Napi::Value Dispose(const Napi::CallbackInfo& info) {
    DisposeNative();
    return info.Env().Undefined();
  }

  static void Init(Napi::Env env, Napi::Object exports) {
    Napi::Function function = DefineClass(
        env, "SpeechSynthesizer",
        {InstanceMethod("listVoices", &SpeechSynthesizerWrap::ListVoices),
         InstanceMethod("listOutputDevices", &SpeechSynthesizerWrap::ListOutputDevices),
         InstanceMethod("speak", &SpeechSynthesizerWrap::Speak),
         InstanceMethod("getOperationState", &SpeechSynthesizerWrap::GetOperationState),
         InstanceMethod("cancel", &SpeechSynthesizerWrap::Cancel),
         InstanceMethod("pause", &SpeechSynthesizerWrap::Pause),
         InstanceMethod("resume", &SpeechSynthesizerWrap::Resume),
         InstanceMethod("dispose", &SpeechSynthesizerWrap::Dispose)});
    constructor = Napi::Persistent(function);
    constructor.SuppressDestruct();
    exports.Set("SpeechSynthesizer", function);
  }

 private:
  void EnsureAvailable() const {
    if (!voice_) throw std::runtime_error("SAPI speech synthesizer is unavailable or disposed");
  }

  void ConfigureVoice(const Napi::Object& options) {
    const Napi::Value voiceId = options.Get("voiceId");
    if (!voiceId.IsUndefined() && !voiceId.IsNull() && voiceId.IsString()) {
      const std::wstring id = FromJsString(voiceId);
      if (!id.empty()) {
        const auto token = OpenToken(id);
        CheckHresult(voice_->SetVoice(token.Get()), "Select SAPI voice");
      }
    }

    const Napi::Value outputDeviceId = options.Get("outputDeviceId");
    if (outputDeviceId.IsUndefined() || outputDeviceId.IsNull() ||
        (outputDeviceId.IsString() && FromJsString(outputDeviceId).empty())) {
      CheckHresult(voice_->SetOutput(nullptr, TRUE), "Select default SAPI output device");
      return;
    }
    if (!outputDeviceId.IsString()) {
      throw std::invalid_argument("SAPI output device id must be a string or null");
    }
    const std::wstring id = FromJsString(outputDeviceId);
    const auto token = OpenToken(id);
    ComPtr<ISpAudio> audio;
    CheckHresult(token->CreateInstance(nullptr, CLSCTX_ALL, IID_PPV_ARGS(&audio)),
                 "Open SAPI output device");
    CheckHresult(voice_->SetOutput(audio.Get(), TRUE), "Select SAPI output device");
  }

  void RefreshState() {
    if (currentOperationId_.empty() || currentState_ != "speaking") return;
    SPVOICESTATUS status{};
    const HRESULT statusResult = voice_->GetStatus(&status, nullptr);
    if (FAILED(statusResult)) {
      currentState_ = "failed";
    } else if (status.dwRunningState == SPRS_DONE) {
      currentState_ = "completed";
    }
    operationStates_[currentOperationId_] = currentState_;
  }

  bool CancelInternal() {
    if (!voice_ || currentOperationId_.empty() ||
        (currentState_ != "speaking" && currentState_ != "paused")) {
      return false;
    }
    CheckHresult(voice_->Speak(nullptr, SPF_PURGEBEFORESPEAK, nullptr), "Cancel SAPI speech");
    currentState_ = "cancelled";
    operationStates_[currentOperationId_] = currentState_;
    return true;
  }

  void DisposeNative() {
    if (voice_) {
      try {
        CancelInternal();
      } catch (...) {
      }
      voice_.Reset();
    }
    if (comInitialized_) {
      CoUninitialize();
      comInitialized_ = false;
    }
  }

  ComPtr<ISpVoice> voice_;
  bool comInitialized_ = false;
  uint64_t operationCounter_ = 0;
  std::string currentOperationId_;
  std::string currentState_ = "completed";
  std::unordered_map<std::string, std::string> operationStates_;
};

Napi::FunctionReference SpeechSynthesizerWrap::constructor;

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  SpeechSynthesizerWrap::Init(env, exports);
  exports.Set("playEarcon", Napi::Function::New(env, PlayEarcon));
  return exports;
}

}  // namespace

NODE_API_MODULE(speech, Init)
