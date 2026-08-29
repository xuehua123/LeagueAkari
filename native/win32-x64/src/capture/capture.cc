#include <napi.h>

#include <Windows.h>
#include <VersionHelpers.h>
#include <d3d11.h>
#include <dxgi1_6.h>
#include <roapi.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <wrl/client.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <initializer_list>
#include <iterator>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/base.h>

using Microsoft::WRL::ComPtr;
using namespace winrt;
using winrt::Windows::Graphics::Capture::Direct3D11CaptureFrame;
using winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool;
using winrt::Windows::Graphics::Capture::GraphicsCaptureItem;
using winrt::Windows::Graphics::Capture::GraphicsCaptureSession;
using winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
using winrt::Windows::Graphics::DirectX::DirectXPixelFormat;
using IDirect3DDxgiInterfaceAccess =
    ::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess;

namespace {

struct NormalizedRoi {
  double x = 0.0;
  double y = 0.0;
  double width = 1.0;
  double height = 1.0;
};

struct CapturedFrame {
  std::vector<uint8_t> pixels;
  uint32_t width = 0;
  uint32_t height = 0;
  uint32_t sourceWidth = 0;
  uint32_t sourceHeight = 0;
  bool hdr = false;
};

struct WindowLookup {
  DWORD pid;
  HWND hwnd;
};

BOOL CALLBACK FindWindowForPid(HWND hwnd, LPARAM parameter) {
  auto* lookup = reinterpret_cast<WindowLookup*>(parameter);
  DWORD windowPid = 0;
  GetWindowThreadProcessId(hwnd, &windowPid);
  if (windowPid != lookup->pid || !IsWindowVisible(hwnd) || GetWindow(hwnd, GW_OWNER) != nullptr) {
    return TRUE;
  }
  RECT rect{};
  if (!GetWindowRect(hwnd, &rect) || rect.right <= rect.left || rect.bottom <= rect.top) {
    return TRUE;
  }
  lookup->hwnd = hwnd;
  return FALSE;
}

HWND ResolveWindow(DWORD pid, HWND requested) {
  if (requested && IsWindow(requested)) return requested;
  if (!pid) return nullptr;
  WindowLookup lookup{pid, nullptr};
  EnumWindows(FindWindowForPid, reinterpret_cast<LPARAM>(&lookup));
  return lookup.hwnd;
}

HWND ReadTargetWindow(const Napi::Object& options) {
  DWORD pid = options.Has("targetPid") && options.Get("targetPid").IsNumber()
                  ? options.Get("targetPid").As<Napi::Number>().Uint32Value()
                  : 0;
  HWND requested = nullptr;
  if (options.Has("targetHwnd")) {
    const auto value = options.Get("targetHwnd");
    if (value.IsBigInt()) {
      bool lossless = false;
      requested = reinterpret_cast<HWND>(value.As<Napi::BigInt>().Uint64Value(&lossless));
      if (!lossless) return nullptr;
    } else if (value.IsNumber()) {
      requested = reinterpret_cast<HWND>(
          static_cast<uintptr_t>(value.As<Napi::Number>().Int64Value()));
    }
  }

  HWND hwnd = ResolveWindow(pid, requested);
  if (!hwnd) return nullptr;
  DWORD actualPid = 0;
  GetWindowThreadProcessId(hwnd, &actualPid);
  if (!actualPid || (pid && actualPid != pid)) return nullptr;
  return hwnd;
}

std::string WideToUtf8(const wchar_t* value) {
  if (!value || !*value) return {};
  const int required = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
  if (required <= 1) return {};
  std::string result(static_cast<size_t>(required), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value, -1, result.data(), required, nullptr, nullptr);
  result.pop_back();
  return result;
}

Napi::Object RectToObject(Napi::Env env, const RECT& rect) {
  Napi::Object result = Napi::Object::New(env);
  result.Set("x", Napi::Number::New(env, rect.left));
  result.Set("y", Napi::Number::New(env, rect.top));
  result.Set("width", Napi::Number::New(env, rect.right - rect.left));
  result.Set("height", Napi::Number::New(env, rect.bottom - rect.top));
  return result;
}

float HalfToFloat(uint16_t value) {
  const uint32_t sign = static_cast<uint32_t>(value & 0x8000) << 16;
  int32_t exponent = (value >> 10) & 0x1f;
  uint32_t mantissa = value & 0x03ff;
  uint32_t result = 0;
  if (exponent == 0) {
    if (mantissa == 0) {
      result = sign;
    } else {
      exponent = 1;
      while ((mantissa & 0x0400) == 0) {
        mantissa <<= 1;
        --exponent;
      }
      mantissa &= 0x03ff;
      result = sign | (static_cast<uint32_t>(exponent + 112) << 23) | (mantissa << 13);
    }
  } else if (exponent == 31) {
    result = sign | 0x7f800000 | (mantissa << 13);
  } else {
    result = sign | (static_cast<uint32_t>(exponent + 112) << 23) | (mantissa << 13);
  }
  float output = 0.0f;
  std::memcpy(&output, &result, sizeof(output));
  return output;
}

uint8_t ToneMap(float linear) {
  const float nonNegative = std::max(0.0f, linear);
  const float mapped = nonNegative / (1.0f + nonNegative);
  const float srgb = mapped <= 0.0031308f ? mapped * 12.92f
                                           : 1.055f * std::pow(mapped, 1.0f / 2.4f) - 0.055f;
  return static_cast<uint8_t>(std::clamp(srgb * 255.0f, 0.0f, 255.0f));
}

uint64_t UnixTimeMilliseconds() {
  return static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
                                   std::chrono::system_clock::now().time_since_epoch())
                                   .count());
}

bool IsHdrColorSpace(DXGI_COLOR_SPACE_TYPE colorSpace) {
  return colorSpace == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020 ||
         colorSpace == DXGI_COLOR_SPACE_RGB_STUDIO_G2084_NONE_P2020;
}

bool TryGetMonitorHdr(HMONITOR monitor, bool* enabled) {
  if (!monitor || !enabled) return false;
  ComPtr<IDXGIFactory1> factory;
  if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return false;
  for (UINT adapterIndex = 0;; ++adapterIndex) {
    ComPtr<IDXGIAdapter1> adapter;
    if (factory->EnumAdapters1(adapterIndex, &adapter) == DXGI_ERROR_NOT_FOUND) break;
    for (UINT outputIndex = 0;; ++outputIndex) {
      ComPtr<IDXGIOutput> output;
      if (adapter->EnumOutputs(outputIndex, &output) == DXGI_ERROR_NOT_FOUND) break;
      DXGI_OUTPUT_DESC outputDesc{};
      if (FAILED(output->GetDesc(&outputDesc)) || outputDesc.Monitor != monitor) continue;
      ComPtr<IDXGIOutput6> output6;
      DXGI_OUTPUT_DESC1 outputDesc1{};
      if (FAILED(output.As(&output6)) || FAILED(output6->GetDesc1(&outputDesc1))) return false;
      *enabled = IsHdrColorSpace(outputDesc1.ColorSpace);
      return true;
    }
  }
  return false;
}

bool IsMonitorHdr(HMONITOR monitor) {
  bool enabled = false;
  return TryGetMonitorHdr(monitor, &enabled) && enabled;
}

class NativeCaptureSession {
 public:
  NativeCaptureSession(std::string backend, HWND hwnd, DWORD pid, NormalizedRoi roi)
      : backend_(std::move(backend)), hwnd_(ResolveWindow(pid, hwnd)), roi_(roi) {
    if (!hwnd_) throw std::runtime_error("Unable to resolve the target game window");
    GetWindowThreadProcessId(hwnd_, &pid_);
    const HRESULT apartmentResult = RoInitialize(RO_INIT_MULTITHREADED);
    if (FAILED(apartmentResult) && apartmentResult != RPC_E_CHANGED_MODE) {
      check_hresult(apartmentResult);
    }
    roInitialized_ = SUCCEEDED(apartmentResult);
    try {
      if (backend_ == "wgc") {
        InitializeWgc();
      } else if (backend_ == "dda") {
        InitializeDda();
      } else {
        throw std::invalid_argument("Capture backend must be wgc or dda");
      }
    } catch (...) {
      Dispose();
      throw;
    }
  }

  ~NativeCaptureSession() { Dispose(); }

  CapturedFrame Capture(uint32_t timeoutMs) {
    if (disposed_) throw std::runtime_error("Capture session is disposed");
    return backend_ == "wgc" ? CaptureWgc(timeoutMs) : CaptureDda(timeoutMs);
  }

  void Dispose() {
    if (disposed_) return;
    disposed_ = true;
    if (framePool_ && frameArrivedToken_.value) {
      try {
        framePool_.FrameArrived(frameArrivedToken_);
      } catch (...) {
      }
    }
    if (captureSession_) captureSession_.Close();
    if (framePool_) framePool_.Close();
    captureSession_ = nullptr;
    framePool_ = nullptr;
    captureItem_ = nullptr;
    duplication_.Reset();
    context_.Reset();
    device_.Reset();
    if (frameEvent_) {
      CloseHandle(frameEvent_);
      frameEvent_ = nullptr;
    }
    if (roInitialized_) {
      RoUninitialize();
      roInitialized_ = false;
    }
  }

  const std::string& Backend() const { return backend_; }

 private:
  void CreateDevice(IDXGIAdapter* adapter = nullptr) {
    UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
    D3D_FEATURE_LEVEL featureLevel{};
    check_hresult(D3D11CreateDevice(adapter, adapter ? D3D_DRIVER_TYPE_UNKNOWN : D3D_DRIVER_TYPE_HARDWARE,
                                    nullptr, flags, nullptr, 0, D3D11_SDK_VERSION, &device_,
                                    &featureLevel, &context_));
  }

  void InitializeWgc() {
    if (!GraphicsCaptureSession::IsSupported()) {
      throw std::runtime_error("Windows Graphics Capture is not supported on this OS");
    }
    CreateDevice();

    ComPtr<IDXGIDevice> dxgiDevice;
    check_hresult(device_.As(&dxgiDevice));
    com_ptr<IInspectable> inspectableDevice;
    check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.Get(), inspectableDevice.put()));
    direct3dDevice_ = inspectableDevice.as<IDirect3DDevice>();

    auto interop = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
    check_hresult(interop->CreateForWindow(hwnd_, guid_of<GraphicsCaptureItem>(), put_abi(captureItem_)));
    const auto size = captureItem_.Size();
    hdr_ = IsMonitorHdr(MonitorFromWindow(hwnd_, MONITOR_DEFAULTTONEAREST));
    wgcPixelFormat_ = hdr_ ? DirectXPixelFormat::R16G16B16A16Float
                           : DirectXPixelFormat::B8G8R8A8UIntNormalized;
    wgcFrameSize_ = size;
    framePool_ = Direct3D11CaptureFramePool::CreateFreeThreaded(
        direct3dDevice_, wgcPixelFormat_, 3, size);
    captureSession_ = framePool_.CreateCaptureSession(captureItem_);
    frameEvent_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!frameEvent_) check_hresult(HRESULT_FROM_WIN32(GetLastError()));
    frameArrivedToken_ = framePool_.FrameArrived([this](auto&&, auto&&) {
      if (frameEvent_) SetEvent(frameEvent_);
    });
    captureSession_.StartCapture();
  }

  void InitializeDda() {
    const HMONITOR targetMonitor = MonitorFromWindow(hwnd_, MONITOR_DEFAULTTONEAREST);
    ComPtr<IDXGIFactory1> factory;
    check_hresult(CreateDXGIFactory1(IID_PPV_ARGS(&factory)));

    ComPtr<IDXGIAdapter1> selectedAdapter;
    ComPtr<IDXGIOutput1> selectedOutput;
    DXGI_OUTPUT_DESC selectedDesc{};
    for (UINT adapterIndex = 0; !selectedOutput; ++adapterIndex) {
      ComPtr<IDXGIAdapter1> adapter;
      if (factory->EnumAdapters1(adapterIndex, &adapter) == DXGI_ERROR_NOT_FOUND) break;
      for (UINT outputIndex = 0;; ++outputIndex) {
        ComPtr<IDXGIOutput> output;
        if (adapter->EnumOutputs(outputIndex, &output) == DXGI_ERROR_NOT_FOUND) break;
        DXGI_OUTPUT_DESC desc{};
        output->GetDesc(&desc);
        if (desc.Monitor == targetMonitor) {
          check_hresult(output.As(&selectedOutput));
          selectedAdapter = adapter;
          selectedDesc = desc;
          break;
        }
      }
    }
    if (!selectedOutput || !selectedAdapter) {
      throw std::runtime_error("Unable to locate the display containing the target window");
    }

    CreateDevice(selectedAdapter.Get());
    ComPtr<IDXGIOutput6> selectedOutput6;
    DXGI_OUTPUT_DESC1 selectedDesc1{};
    hdr_ = SUCCEEDED(selectedOutput.As(&selectedOutput6)) &&
           SUCCEEDED(selectedOutput6->GetDesc1(&selectedDesc1)) &&
           IsHdrColorSpace(selectedDesc1.ColorSpace);
    ComPtr<IDXGIOutput5> selectedOutput5;
    if (hdr_ && SUCCEEDED(selectedOutput.As(&selectedOutput5))) {
      const DXGI_FORMAT supportedFormats[] = {DXGI_FORMAT_R16G16B16A16_FLOAT,
                                               DXGI_FORMAT_B8G8R8A8_UNORM};
      const HRESULT duplicateResult = selectedOutput5->DuplicateOutput1(
          device_.Get(), 0, static_cast<UINT>(std::size(supportedFormats)), supportedFormats,
          &duplication_);
      if (FAILED(duplicateResult)) duplication_.Reset();
    }
    if (!duplication_) {
      check_hresult(selectedOutput->DuplicateOutput(device_.Get(), &duplication_));
    }
    outputRect_ = selectedDesc.DesktopCoordinates;
  }

  CapturedFrame CopyRegion(ID3D11Texture2D* source, const D3D11_BOX& box, bool hdr) {
    const uint32_t width = box.right - box.left;
    const uint32_t height = box.bottom - box.top;
    if (!width || !height) return {};

    D3D11_TEXTURE2D_DESC sourceDesc{};
    source->GetDesc(&sourceDesc);
    if (box.left >= box.right || box.top >= box.bottom || box.right > sourceDesc.Width ||
        box.bottom > sourceDesc.Height || box.front != 0 || box.back != 1) {
      throw std::runtime_error("Capture ROI is outside the source texture bounds");
    }
    if (sourceDesc.Format != DXGI_FORMAT_B8G8R8A8_UNORM &&
        sourceDesc.Format != DXGI_FORMAT_R16G16B16A16_FLOAT) {
      throw std::runtime_error("Unsupported capture texture format");
    }

    D3D11_TEXTURE2D_DESC stagingDesc = sourceDesc;
    stagingDesc.Width = width;
    stagingDesc.Height = height;
    stagingDesc.MipLevels = 1;
    stagingDesc.ArraySize = 1;
    stagingDesc.SampleDesc = {1, 0};
    stagingDesc.Usage = D3D11_USAGE_STAGING;
    stagingDesc.BindFlags = 0;
    stagingDesc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    stagingDesc.MiscFlags = 0;

    ComPtr<ID3D11Texture2D> staging;
    check_hresult(device_->CreateTexture2D(&stagingDesc, nullptr, &staging));
    context_->CopySubresourceRegion(staging.Get(), 0, 0, 0, 0, source, 0, &box);

    D3D11_MAPPED_SUBRESOURCE mapped{};
    check_hresult(context_->Map(staging.Get(), 0, D3D11_MAP_READ, 0, &mapped));
    CapturedFrame result;
    result.width = width;
    result.height = height;
    result.hdr = hdr || sourceDesc.Format == DXGI_FORMAT_R16G16B16A16_FLOAT;
    result.pixels.resize(static_cast<size_t>(width) * height * 4);

    if (sourceDesc.Format == DXGI_FORMAT_B8G8R8A8_UNORM) {
      for (uint32_t y = 0; y < height; ++y) {
        std::memcpy(result.pixels.data() + static_cast<size_t>(y) * width * 4,
                    static_cast<const uint8_t*>(mapped.pData) + static_cast<size_t>(y) * mapped.RowPitch,
                    static_cast<size_t>(width) * 4);
      }
    } else {
      for (uint32_t y = 0; y < height; ++y) {
        const auto* row = reinterpret_cast<const uint16_t*>(
            static_cast<const uint8_t*>(mapped.pData) + static_cast<size_t>(y) * mapped.RowPitch);
        for (uint32_t x = 0; x < width; ++x) {
          const size_t sourceIndex = static_cast<size_t>(x) * 4;
          const size_t destinationIndex = (static_cast<size_t>(y) * width + x) * 4;
          result.pixels[destinationIndex] = ToneMap(HalfToFloat(row[sourceIndex + 2]));
          result.pixels[destinationIndex + 1] = ToneMap(HalfToFloat(row[sourceIndex + 1]));
          result.pixels[destinationIndex + 2] = ToneMap(HalfToFloat(row[sourceIndex]));
          result.pixels[destinationIndex + 3] = 255;
        }
      }
    }
    context_->Unmap(staging.Get(), 0);
    return result;
  }

  D3D11_BOX CropBox(uint32_t width, uint32_t height, uint32_t offsetX = 0,
                    uint32_t offsetY = 0) const {
    if (!width || !height) return D3D11_BOX{};
    const uint32_t localLeft = std::min(
        width - 1, static_cast<uint32_t>(std::floor(std::clamp(roi_.x, 0.0, 1.0) * width)));
    const uint32_t localTop = std::min(
        height - 1, static_cast<uint32_t>(std::floor(std::clamp(roi_.y, 0.0, 1.0) * height)));
    const uint32_t localRight = std::min(
        width, std::max(localLeft + 1,
                        static_cast<uint32_t>(std::ceil(
                            std::clamp(roi_.x + roi_.width, 0.0, 1.0) * width))));
    const uint32_t localBottom = std::min(
        height, std::max(localTop + 1,
                         static_cast<uint32_t>(std::ceil(
                             std::clamp(roi_.y + roi_.height, 0.0, 1.0) * height))));
    return D3D11_BOX{offsetX + localLeft, offsetY + localTop, 0, offsetX + localRight,
                     offsetY + localBottom, 1};
  }

  CapturedFrame CaptureWgc(uint32_t timeoutMs) {
    ResetEvent(frameEvent_);
    Direct3D11CaptureFrame frame{nullptr};
    frame = framePool_.TryGetNextFrame();
    if (!frame) {
      if (WaitForSingleObject(frameEvent_, timeoutMs) != WAIT_OBJECT_0) return {};
      frame = framePool_.TryGetNextFrame();
    }
    if (!frame) return {};

    auto access = frame.Surface().as<IDirect3DDxgiInterfaceAccess>();
    ComPtr<ID3D11Texture2D> texture;
    check_hresult(access->GetInterface(IID_PPV_ARGS(&texture)));
    D3D11_TEXTURE2D_DESC desc{};
    texture->GetDesc(&desc);
    const auto contentSize = frame.ContentSize();
    const uint32_t contentWidth = std::min(
        desc.Width, static_cast<uint32_t>(std::max(0, contentSize.Width)));
    const uint32_t contentHeight = std::min(
        desc.Height, static_cast<uint32_t>(std::max(0, contentSize.Height)));
    if (!contentWidth || !contentHeight) return {};

    CapturedFrame result =
        CopyRegion(texture.Get(), CropBox(contentWidth, contentHeight), hdr_);
    result.sourceWidth = contentWidth;
    result.sourceHeight = contentHeight;

    // WGC frame pools keep their original allocation after a window/DPI resize. Use the
    // current frame's ContentSize for this crop, then recreate the pool so subsequent frames
    // use the new dimensions instead of silently returning padded or truncated pixels.
    const bool sizeChanged = contentSize.Width > 0 && contentSize.Height > 0 &&
                             (contentSize.Width != wgcFrameSize_.Width ||
                              contentSize.Height != wgcFrameSize_.Height);
    frame.Close();
    if (sizeChanged) {
      framePool_.Recreate(direct3dDevice_, wgcPixelFormat_, 3, contentSize);
      wgcFrameSize_ = contentSize;
    }
    return result;
  }

  CapturedFrame CaptureDda(uint32_t timeoutMs) {
    DWORD foregroundPid = 0;
    GetWindowThreadProcessId(GetForegroundWindow(), &foregroundPid);
    if (!foregroundPid || foregroundPid != pid_) return {};
    DXGI_OUTDUPL_FRAME_INFO frameInfo{};
    ComPtr<IDXGIResource> desktopResource;
    const HRESULT acquired = duplication_->AcquireNextFrame(timeoutMs, &frameInfo, &desktopResource);
    if (acquired == DXGI_ERROR_WAIT_TIMEOUT) return {};
    check_hresult(acquired);
    struct FrameRelease {
      IDXGIOutputDuplication* duplication;
      ~FrameRelease() { duplication->ReleaseFrame(); }
    } release{duplication_.Get()};

    ComPtr<ID3D11Texture2D> texture;
    check_hresult(desktopResource.As(&texture));
    D3D11_TEXTURE2D_DESC desc{};
    texture->GetDesc(&desc);

    RECT windowRect{};
    if (!GetWindowRect(hwnd_, &windowRect)) return {};
    const LONG left = std::max(windowRect.left, outputRect_.left);
    const LONG top = std::max(windowRect.top, outputRect_.top);
    const LONG right = std::min(windowRect.right, outputRect_.right);
    const LONG bottom = std::min(windowRect.bottom, outputRect_.bottom);
    if (right <= left || bottom <= top) return {};

    const uint32_t windowWidth = static_cast<uint32_t>(right - left);
    const uint32_t windowHeight = static_cast<uint32_t>(bottom - top);
    auto box = CropBox(windowWidth, windowHeight,
                       static_cast<uint32_t>(left - outputRect_.left),
                       static_cast<uint32_t>(top - outputRect_.top));
    box.right = std::min(box.right, desc.Width);
    box.bottom = std::min(box.bottom, desc.Height);
    CapturedFrame result =
        CopyRegion(texture.Get(), box, desc.Format == DXGI_FORMAT_R16G16B16A16_FLOAT);
    result.sourceWidth = windowWidth;
    result.sourceHeight = windowHeight;
    return result;
  }

  std::string backend_;
  HWND hwnd_ = nullptr;
  DWORD pid_ = 0;
  NormalizedRoi roi_;
  bool disposed_ = false;
  bool hdr_ = false;
  bool roInitialized_ = false;
  ComPtr<ID3D11Device> device_;
  ComPtr<ID3D11DeviceContext> context_;

  IDirect3DDevice direct3dDevice_{nullptr};
  GraphicsCaptureItem captureItem_{nullptr};
  Direct3D11CaptureFramePool framePool_{nullptr};
  GraphicsCaptureSession captureSession_{nullptr};
  event_token frameArrivedToken_{};
  HANDLE frameEvent_ = nullptr;
  DirectXPixelFormat wgcPixelFormat_ = DirectXPixelFormat::B8G8R8A8UIntNormalized;
  winrt::Windows::Graphics::SizeInt32 wgcFrameSize_{};

  ComPtr<IDXGIOutputDuplication> duplication_;
  RECT outputRect_{};
};

class CaptureSessionWrap : public Napi::ObjectWrap<CaptureSessionWrap> {
 public:
  static Napi::FunctionReference constructor;

  explicit CaptureSessionWrap(const Napi::CallbackInfo& info) : Napi::ObjectWrap<CaptureSessionWrap>(info) {
    Napi::Env env = info.Env();
    try {
      if (info.Length() < 1 || !info[0].IsObject()) {
        throw std::invalid_argument("CaptureSession options object is required");
      }
      const auto options = info[0].As<Napi::Object>();
      if (!options.Has("backend") || !options.Get("backend").IsString()) {
        throw std::invalid_argument("Capture backend must be a string");
      }
      const std::string backend = options.Get("backend").As<Napi::String>().Utf8Value();
      DWORD pid = options.Has("targetPid") && options.Get("targetPid").IsNumber()
                      ? options.Get("targetPid").As<Napi::Number>().Uint32Value()
                      : 0;
      HWND hwnd = nullptr;
      if (options.Has("targetHwnd")) {
        const auto value = options.Get("targetHwnd");
        if (value.IsBigInt()) {
          bool lossless = false;
          hwnd = reinterpret_cast<HWND>(value.As<Napi::BigInt>().Uint64Value(&lossless));
          if (!lossless) throw std::invalid_argument("targetHwnd BigInt is out of range");
        } else if (value.IsNumber()) {
          hwnd = reinterpret_cast<HWND>(
              static_cast<uintptr_t>(value.As<Napi::Number>().Int64Value()));
        }
      }
      if (!options.Has("roi") || !options.Get("roi").IsObject()) {
        throw std::invalid_argument("Normalized ROI is required");
      }
      const auto roiObject = options.Get("roi").As<Napi::Object>();
      for (const char* field : {"x", "y", "width", "height"}) {
        if (!roiObject.Has(field) || !roiObject.Get(field).IsNumber()) {
          throw std::invalid_argument("Normalized ROI fields must be numbers");
        }
      }
      NormalizedRoi roi{roiObject.Get("x").As<Napi::Number>().DoubleValue(),
                        roiObject.Get("y").As<Napi::Number>().DoubleValue(),
                        roiObject.Get("width").As<Napi::Number>().DoubleValue(),
                        roiObject.Get("height").As<Napi::Number>().DoubleValue()};
      if (roi.x < 0 || roi.y < 0 || roi.width <= 0 || roi.height <= 0 ||
          roi.x + roi.width > 1.0001 || roi.y + roi.height > 1.0001) {
        throw std::invalid_argument("Normalized ROI is outside the capture bounds");
      }
      session_ = std::make_unique<NativeCaptureSession>(backend, hwnd, pid, roi);
    } catch (const hresult_error& error) {
      Napi::Error::New(env, to_string(error.message())).ThrowAsJavaScriptException();
    } catch (const std::exception& error) {
      Napi::Error::New(env, error.what()).ThrowAsJavaScriptException();
    }
  }

  Napi::Value CaptureFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!session_) return env.Null();
    try {
      const uint32_t timeoutMs = info.Length() && info[0].IsNumber()
                                     ? std::clamp(info[0].As<Napi::Number>().Uint32Value(), 1u, 1000u)
                                     : 100u;
      CapturedFrame frame = session_->Capture(timeoutMs);
      if (frame.pixels.empty()) return env.Null();
      Napi::Object result = Napi::Object::New(env);
      result.Set("buffer", Napi::Buffer<uint8_t>::Copy(env, frame.pixels.data(), frame.pixels.size()));
      result.Set("width", Napi::Number::New(env, frame.width));
      result.Set("height", Napi::Number::New(env, frame.height));
      result.Set("sourceWidth", Napi::Number::New(env, frame.sourceWidth));
      result.Set("sourceHeight", Napi::Number::New(env, frame.sourceHeight));
      result.Set("pixelFormat", Napi::String::New(env, "bgra"));
      result.Set("backend", Napi::String::New(env, session_->Backend()));
      result.Set("hdr", Napi::Boolean::New(env, frame.hdr));
      result.Set("observedAt", Napi::Number::New(env, static_cast<double>(UnixTimeMilliseconds())));
      return result;
    } catch (const hresult_error& error) {
      Napi::Error::New(env, to_string(error.message())).ThrowAsJavaScriptException();
    } catch (const std::exception& error) {
      Napi::Error::New(env, error.what()).ThrowAsJavaScriptException();
    }
    return env.Null();
  }

  Napi::Value Dispose(const Napi::CallbackInfo& info) {
    if (session_) {
      session_->Dispose();
      session_.reset();
    }
    return info.Env().Undefined();
  }

  static void Init(Napi::Env env, Napi::Object exports) {
    Napi::Function function = DefineClass(
        env, "CaptureSession",
        {InstanceMethod("captureFrame", &CaptureSessionWrap::CaptureFrame),
         InstanceMethod("dispose", &CaptureSessionWrap::Dispose)});
    constructor = Napi::Persistent(function);
    constructor.SuppressDestruct();
    exports.Set("CaptureSession", function);
  }

 private:
  std::unique_ptr<NativeCaptureSession> session_;
};

Napi::FunctionReference CaptureSessionWrap::constructor;

Napi::Boolean IsWgcSupported(const Napi::CallbackInfo& info) {
  const HRESULT apartmentResult = RoInitialize(RO_INIT_MULTITHREADED);
  const bool shouldUninitialize = SUCCEEDED(apartmentResult);
  bool supported = false;
  try {
    if (SUCCEEDED(apartmentResult) || apartmentResult == RPC_E_CHANGED_MODE) {
      supported = GraphicsCaptureSession::IsSupported();
    }
  } catch (...) {
    supported = false;
  }
  if (shouldUninitialize) RoUninitialize();
  return Napi::Boolean::New(info.Env(), supported);
}

Napi::Boolean IsDdaSupported(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), IsWindows8OrGreater());
}

Napi::Value InspectTargetEnvironment(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) return env.Null();

  const HWND hwnd = ReadTargetWindow(info[0].As<Napi::Object>());
  if (!hwnd) return env.Null();

  RECT windowRect{};
  RECT clientRect{};
  if (!GetWindowRect(hwnd, &windowRect) || !GetClientRect(hwnd, &clientRect)) return env.Null();
  POINT clientTopLeft{clientRect.left, clientRect.top};
  POINT clientBottomRight{clientRect.right, clientRect.bottom};
  if (!ClientToScreen(hwnd, &clientTopLeft) || !ClientToScreen(hwnd, &clientBottomRight)) {
    return env.Null();
  }
  clientRect = {clientTopLeft.x, clientTopLeft.y, clientBottomRight.x, clientBottomRight.y};
  if (windowRect.right <= windowRect.left || windowRect.bottom <= windowRect.top ||
      clientRect.right <= clientRect.left || clientRect.bottom <= clientRect.top) {
    return env.Null();
  }

  const HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  MONITORINFOEXW monitorInfo{};
  monitorInfo.cbSize = sizeof(monitorInfo);
  if (!monitor || !GetMonitorInfoW(monitor, &monitorInfo)) return env.Null();
  const std::string displayId = WideToUtf8(monitorInfo.szDevice);
  if (displayId.empty()) return env.Null();

  DWORD targetPid = 0;
  GetWindowThreadProcessId(hwnd, &targetPid);
  if (!targetPid) return env.Null();

  Napi::Object result = Napi::Object::New(env);
  result.Set("targetPid", Napi::Number::New(env, targetPid));
  result.Set("displayId", Napi::String::New(env, displayId));
  result.Set("windowBounds", RectToObject(env, windowRect));
  result.Set("clientBounds", RectToObject(env, clientRect));
  result.Set("monitorBounds", RectToObject(env, monitorInfo.rcMonitor));

  const UINT dpi = GetDpiForWindow(hwnd);
  if (dpi) {
    result.Set("dpiScale", Napi::Number::New(env, static_cast<double>(dpi) / 96.0));
  } else {
    result.Set("dpiScale", env.Null());
  }

  bool hdrEnabled = false;
  if (TryGetMonitorHdr(monitor, &hdrEnabled)) {
    result.Set("hdr", Napi::Boolean::New(env, hdrEnabled));
  } else {
    result.Set("hdr", env.Null());
  }

  const LONG_PTR style = GetWindowLongPtrW(hwnd, GWL_STYLE);
  const bool clearlyWindowed =
      (style & WS_OVERLAPPEDWINDOW) != 0 &&
      (windowRect.left != monitorInfo.rcMonitor.left ||
       windowRect.top != monitorInfo.rcMonitor.top ||
       windowRect.right != monitorInfo.rcMonitor.right ||
       windowRect.bottom != monitorInfo.rcMonitor.bottom);
  // A monitor-covering popup can be borderless or exclusive fullscreen. Win32 does not expose a
  // reliable distinction here, so it must remain unknown instead of being guessed.
  result.Set("windowMode", Napi::String::New(env, clearlyWindowed ? "windowed" : "unknown"));
  return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  CaptureSessionWrap::Init(env, exports);
  exports.Set("isWgcSupported", Napi::Function::New(env, IsWgcSupported));
  exports.Set("isDdaSupported", Napi::Function::New(env, IsDdaSupported));
  exports.Set("inspectTargetEnvironment", Napi::Function::New(env, InspectTargetEnvironment));
  return exports;
}

}  // namespace

NODE_API_MODULE(capture, Init)
