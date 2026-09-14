#!/usr/bin/env bash
set -euo pipefail

MOONSHINE_COMMIT="234f60faa0eb388b01cdf7e60aca232af37aefda"
ORT_VERSION="1.23.2"
ORT_COMMIT="a83fc4d58cb48eb68890dd689f94f28288cf2278"
EMSCRIPTEN_VERSION="4.0.8"
FLATBUFFERS_VERSION="25.2.10"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_ROOT="${1:-$(mktemp -d /tmp/atoms-moonshine-single-thread.XXXXXX)}"
MOONSHINE_ROOT="$BUILD_ROOT/moonshine"
ORT_ROOT="$BUILD_ROOT/ort"
VENV_ROOT="$BUILD_ROOT/python"

if [[ -z "${EMSDK:-}" || ! -f "$EMSDK/emsdk_env.sh" ]]; then
  echo "Set EMSDK to an emsdk checkout with Emscripten ${EMSCRIPTEN_VERSION} installed." >&2
  exit 1
fi

mkdir -p "$BUILD_ROOT"
# shellcheck disable=SC1090
source "$EMSDK/emsdk_env.sh" >/dev/null
if ! emcc --version | head -1 | grep -Fq " ${EMSCRIPTEN_VERSION} "; then
  echo "Emscripten ${EMSCRIPTEN_VERSION} is required." >&2
  exit 1
fi

python3 -m venv "$VENV_ROOT"
"$VENV_ROOT/bin/python3" -m pip install --disable-pip-version-check "flatbuffers==${FLATBUFFERS_VERSION}"
export PATH="$VENV_ROOT/bin:$PATH"

git clone --filter=blob:none --no-checkout https://github.com/moonshine-ai/moonshine.git "$MOONSHINE_ROOT"
git -C "$MOONSHINE_ROOT" fetch --depth 1 origin "$MOONSHINE_COMMIT"
git -C "$MOONSHINE_ROOT" checkout --detach "$MOONSHINE_COMMIT"
if [[ "$(git -C "$MOONSHINE_ROOT" rev-parse HEAD)" != "$MOONSHINE_COMMIT" ]]; then
  echo "Moonshine source commit verification failed." >&2
  exit 1
fi

fetch_lfs_source() {
  local path="$1" sha256="$2" byte_size="$3"
  local target="$MOONSHINE_ROOT/$path" temporary="$target.download"
  curl -fL --retry 3 \
    "https://media.githubusercontent.com/media/moonshine-ai/moonshine/${MOONSHINE_COMMIT}/${path}" \
    -o "$temporary"
  local actual_size actual_sha256
  actual_size="$(stat -f%z "$temporary" 2>/dev/null || stat -c%s "$temporary")"
  actual_sha256="$(shasum -a 256 "$temporary" | awk '{print $1}')"
  if [[ "$actual_size" != "$byte_size" || "$actual_sha256" != "$sha256" ]]; then
    echo "Git LFS source verification failed for $path." >&2
    exit 1
  fi
  mv "$temporary" "$target"
}

fetch_lfs_source \
  "core/moonshine-tts/src/zipvoice-voices-data.cpp" \
  "f3e4d62cae93c465e1de8521bc5706b9a20f834cbbf37404bf03f0d35dffa012" \
  "11695724"
fetch_lfs_source \
  "core/cpp-annote/src/community1_cpp_annote_embedded.cpp" \
  "9424da4176b33e67e4000ea2a776d64b6a78ee9bbf72d40405fb6805d12758c4" \
  "2535244"

git clone --recursive --depth 1 --branch "v${ORT_VERSION}" \
  https://github.com/microsoft/onnxruntime.git "$ORT_ROOT/onnxruntime"
if [[ "$(git -C "$ORT_ROOT/onnxruntime" rev-parse HEAD)" != "$ORT_COMMIT" ]]; then
  echo "ONNX Runtime source commit verification failed." >&2
  exit 1
fi

"$ORT_ROOT/onnxruntime/build.sh" \
  --build_dir "$ORT_ROOT/build-simd" \
  --config Release \
  --build_wasm_static_lib \
  --enable_wasm_simd \
  --disable_wasm_exception_catching \
  --enable_wasm_api_exception_catching \
  --minimal_build extended custom_ops \
  --include_ops_by_config "$MOONSHINE_ROOT/core/third-party/onnxruntime/moonshine-required-operators.config" \
  --disable_ml_ops \
  --skip_tests \
  --parallel \
  --compile_no_warning_as_error \
  --emsdk_version "$EMSCRIPTEN_VERSION" \
  --cmake_extra_defines onnxruntime_USE_KLEIDIAI=OFF onnxruntime_BUILD_UNIT_TESTS=OFF

cp "$ORT_ROOT/build-simd/Release/libonnxruntime_webassembly.a" \
  "$MOONSHINE_ROOT/core/third-party/onnxruntime/lib/wasm/libonnxruntime_webassembly_singlethread.a"
(
  cd "$MOONSHINE_ROOT"
  ./scripts/build-wasm.sh single-thread skip-ort
)

mkdir -p "$PACKAGE_ROOT/vendor/moonshine-wasm-single-thread"
cp "$MOONSHINE_ROOT/language-bindings/wasm/dist/moonshine.mjs" \
  "$PACKAGE_ROOT/vendor/moonshine-wasm-single-thread/moonshine.mjs"
cp "$MOONSHINE_ROOT/language-bindings/wasm/dist/moonshine.wasm" \
  "$PACKAGE_ROOT/vendor/moonshine-wasm-single-thread/moonshine.wasm"
(
  cd "$PACKAGE_ROOT"
  npm run runtime:prepare
)

echo "Rebuilt the verified single-thread SIMD runtime in $BUILD_ROOT"
