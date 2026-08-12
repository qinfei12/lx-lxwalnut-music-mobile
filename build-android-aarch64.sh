#!/usr/bin/env bash
#
# build-android-aarch64.sh
# ----------------------------------------------------------------------------
# 在 aarch64 (arm64) Ubuntu 容器中本地编译本项目 (lx-lxwalnut-music-mobile) 的
# Android APK。
#
# 适用环境:
#   - 手机 Termux + proot Ubuntu (aarch64)
#   - 树莓派 4/5 (aarch64 Ubuntu)
#   - Apple Silicon 上的 Docker arm64 容器
#   - 任意 aarch64 Ubuntu 22.04 / 24.04 容器
#
# 用法:
#   ./build-android-aarch64.sh                 # 全流程：装依赖 → 装 SDK → 构建 arm64-v8a
#   ./build-android-aarch64.sh --setup-only    # 仅安装环境，不构建
#   ./build-android-aarch64.sh --build-only    # 跳过环境安装，仅构建
#   ./build-android-aarch64.sh --clean         # 构建前 gradlew clean
#   ./build-android-aarch64.sh --abi all       # 构建全部 ABI
#   ./build-android-aarch64.sh --debug         # 构建 Debug 变体
#
# 可选环境变量覆盖:
#   INSTALL_ROOT          安装根目录，默认 ~/.local/android-build
#   ANDROID_HOME          Android SDK 路径，默认 $INSTALL_ROOT/sdk
#   JAVA_HOME             JDK 路径，默认自动探测 $INSTALL_ROOT/jdk/*
#   NODE_VERSION          Node 版本，默认 18
#   JAVA_VERSION          JDK 版本，默认 21
#   NDK_VERSION           NDK 版本，默认 26.1.10909125
#   BUILD_TOOLS_VERSION   build-tools 版本，默认 35.0.0
#   ANDROID_PLATFORM      Android 平台，默认 android-35
#   BUILD_ABI             默认 ABI，默认 arm64-v8a
#   KEYSTORE_PATH         自定义 release keystore 路径（不传则自动生成）
#   KEYSTORE_PASSWORD     keystore 密码，默认 android
#   KEY_ALIAS             key 别名，默认 release
#   KEY_PASSWORD          key 密码，默认 android
#
# 说明:
#   - 脚本幂等，可重复执行；已存在的依赖会自动跳过。
#   - 首次运行需要下载 ~3GB 内容（JDK / Android SDK / NDK / node_modules）。
#   - 自动生成 ~/.local/android-build/env.sh，可 `source` 后手动执行构建。
# ----------------------------------------------------------------------------

set -euo pipefail

# ----------------------------- 颜色输出 -----------------------------
if [[ -t 1 ]]; then
    C_RED=$'\033[0;31m';    C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[0;33m'
    C_BLUE=$'\033[0;34m';   C_CYAN=$'\033[0;36m';  C_RESET=$'\033[0m'
else
    C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_CYAN=''; C_RESET=''
fi

log()  { printf '%s[+]%s %s\n' "$C_GREEN"  "$C_RESET" "$*"; }
info() { printf '%s[i]%s %s\n' "$C_BLUE"   "$C_RESET" "$*"; }
warn() { printf '%s[!]%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()  { printf '%s[x]%s %s\n' "$C_RED"    "$C_RESET" "$*" >&2; }
die()  { err "$*"; exit 1; }
run()  { printf '%s[>]%s %s\n' "$C_CYAN" "$C_RESET" "$*"; "$@"; }

# ----------------------------- 默认配置 -----------------------------
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

NODE_VERSION="${NODE_VERSION:-18}"
JAVA_VERSION="${JAVA_VERSION:-21}"
BUILD_TOOLS_VERSION="${BUILD_TOOLS_VERSION:-35.0.0}"
ANDROID_PLATFORM="${ANDROID_PLATFORM:-android-35}"
NDK_VERSION="${NDK_VERSION:-26.1.10909125}"

INSTALL_ROOT="${INSTALL_ROOT:-$HOME/.local/android-build}"
ANDROID_HOME="${ANDROID_HOME:-$INSTALL_ROOT/sdk}"
JAVA_HOME_BASE="${JAVA_HOME_BASE:-$INSTALL_ROOT/jdk}"
ENV_FILE="${ENV_FILE:-$INSTALL_ROOT/env.sh}"

KEYSTORE_PATH="${KEYSTORE_PATH:-}"
KEYSTORE_PASSWORD="${KEYSTORE_PASSWORD:-android}"
KEY_ALIAS="${KEY_ALIAS:-release}"
KEY_PASSWORD="${KEY_PASSWORD:-android}"

BUILD_ABI="${BUILD_ABI:-arm64-v8a}"
BUILD_VARIANT="release"
DO_CLEAN=0
SETUP_ONLY=0
BUILD_ONLY=0

# ----------------------------- 参数解析 -----------------------------
usage() {
    sed -n 's/^# \{0,1\}//p' "${BASH_SOURCE[0]}" | sed -n '2,/^---*$/p'
    cat <<EOF

选项:
  --setup-only   仅安装环境，不构建
  --build-only   跳过环境安装，仅构建
  --clean        构建前 gradlew clean
  --debug        构建 Debug 变体 (默认 Release)
  --abi <ABI>    指定 ABI (arm64-v8a | armeabi-v7a | x86 | x86_64 | all)
  --help, -h     显示帮助
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --setup-only) SETUP_ONLY=1; shift ;;
        --build-only) BUILD_ONLY=1; shift ;;
        --clean)      DO_CLEAN=1; shift ;;
        --debug)      BUILD_VARIANT="debug"; shift ;;
        --abi)        BUILD_ABI="$2"; shift 2 ;;
        --help|-h)    usage; exit 0 ;;
        *)            die "未知参数: $1 (使用 --help 查看)" ;;
    esac
done

[[ "$BUILD_ONLY" = 1 && "$SETUP_ONLY" = 1 ]] && die "--build-only 与 --setup-only 互斥"

# ----------------------------- 工具函数 -----------------------------
# 容器内通常以 root 运行，sudo 不一定存在；以 root 身份自动剥离 sudo
SUDO=""
if [[ $EUID -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
        SUDO="sudo"
    else
        die "当前非 root 且未安装 sudo，无法继续"
    fi
fi

have() { command -v "$1" >/dev/null 2>&1; }

# 探测 JDK 路径：优先 JAVA_HOME，其次 $JAVA_HOME_BASE 下任意目录
resolve_java_home() {
    if [[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" ]]; then
        return
    fi
    local candidate
    # 优先匹配 microsoft-jdk-<ver>
    for candidate in "$JAVA_HOME_BASE"/jdk-"$JAVA_VERSION"* \
                     "$JAVA_HOME_BASE"/microsoft-jdk-"$JAVA_VERSION"* \
                     "$JAVA_HOME_BASE"/*/ ; do
        [[ -x "$candidate/bin/java" ]] || continue
        if "$candidate/bin/java" -version 2>&1 | grep -q "version \"${JAVA_VERSION}\."; then
            export JAVA_HOME="$candidate"
            return
        fi
    done
    # 兜底：系统 JDK
    if have java; then
        local sys_jh
        sys_jh="$(java -XshowSettings:properties -version 2>&1 | awk -F'=' '/java.home/{gsub(/^[ \t]+|[ \t]+$/,"",$2); print $2; exit}')"
        if "$sys_jh/bin/java" -version 2>&1 | grep -q "version \"${JAVA_VERSION}\."; then
            export JAVA_HOME="$sys_jh"
            return
        fi
    fi
    export JAVA_HOME=""
}

# ----------------------------- 步骤：架构检查 -----------------------------
check_arch() {
    local arch
    arch="$(uname -m)"
    case "$arch" in
        aarch64|arm64) log "架构检查通过: $arch" ;;
        *) die "本脚本仅在 aarch64/arm64 上运行，当前架构: $arch
若需在 x86_64 上构建，请直接使用项目原生 npm scripts (npm run pack:android)。" ;;
    esac
}

# ----------------------------- 步骤：系统依赖 -----------------------------
install_system_deps() {
    log "安装系统依赖 (apt)..."
    have apt-get || die "未找到 apt-get，本脚本仅支持 Ubuntu/Debian 系容器"

    export DEBIAN_FRONTEND=noninteractive
    run $SUDO apt-get update -y
    # libtinfo5 在新版 Ubuntu 已不存在，单独安装并忽略失败
    run $SUDO apt-get install -y --no-install-recommends \
        ca-certificates curl wget git unzip zip tar xz-utils \
        build-essential make g++ \
        python3 python3-pip \
        libstdc++6 zlib1g

    if ! $SUDO apt-get install -y --no-install-recommends libtinfo5 2>/dev/null; then
        warn "libtinfo5 不可用（在新版 Ubuntu 已移除），已忽略"
    fi

    mkdir -p "$INSTALL_ROOT"
}

# ----------------------------- 步骤：Node.js -----------------------------
install_node() {
    # 检查现有 Node 版本是否匹配
    if have node; then
        local cur_major
        cur_major="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
        if [[ "$cur_major" = "$NODE_VERSION" ]]; then
            log "Node.js $(node -v) 已满足要求，跳过安装"
            _export_node_path
            return
        fi
    fi

    log "通过 NodeSource 安装 Node.js $NODE_VERSION (aarch64)..."
    if ! have curl; then die "curl 未安装"; fi
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | $SUDO -E bash -
    run $SUDO apt-get install -y nodejs
    have node || die "Node.js 安装失败"

    log "Node.js 已就绪: $(node -v) / npm $(npm -v)"
    _export_node_path
}

_export_node_path() {
    # 让后续 npm 命令使用本地缓存
    npm config set cache "$INSTALL_ROOT/npm-cache" 2>/dev/null || true
}

# ----------------------------- 步骤：JDK -----------------------------
install_jdk() {
    resolve_java_home
    if [[ -n "${JAVA_HOME:-}" ]]; then
        log "JDK $JAVA_VERSION 已存在: $JAVA_HOME"
        return
    fi

    log "下载 Microsoft OpenJDK $JAVA_VERSION (aarch64)..."
    mkdir -p "$JAVA_HOME_BASE"

    # Microsoft OpenJDK 21 aarch64 Linux tarball
    local jdk_url="https://aka.ms/download-jdk/microsoft-jdk-${JAVA_VERSION}-linux-aarch64.tar.gz"
    local tmpfile
    tmpfile="$(mktemp -t jdk-XXXXXX.tar.gz)"
    curl -fsSL -o "$tmpfile" "$jdk_url" || { rm -f "$tmpfile"; die "下载 JDK 失败"; }

    tar -xzf "$tmpfile" -C "$JAVA_HOME_BASE"
    rm -f "$tmpfile"

    resolve_java_home
    [[ -n "${JAVA_HOME:-}" ]] || die "JDK 解压后未探测到 JAVA_HOME"
    log "JDK 安装完成: $JAVA_HOME"
    "$JAVA_HOME/bin/java" -version
}

# ----------------------------- 步骤：Android SDK -----------------------------
install_android_sdk() {
    local sdkmanager
    if [[ -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]]; then
        log "Android cmdline-tools 已存在，跳过下载"
        sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
    else
        log "下载 Android cmdline-tools..."
        mkdir -p "$ANDROID_HOME/cmdline-tools"
        # cmdline-tools 12.0 (11076708) 起官方支持 aarch64 Linux 主机
        local cmdline_url="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
        local tmpfile
        tmpfile="$(mktemp -t cmdline-XXXXXX.zip)"
        curl -fsSL -o "$tmpfile" "$cmdline_url" || { rm -f "$tmpfile"; die "下载 cmdline-tools 失败"; }

        local staging
        staging="$(mktemp -d -t cmdline-extract-XXXXXX)"
        unzip -q "$tmpfile" -d "$staging"
        rm -f "$tmpfile"

        # 标准 layout: $ANDROID_HOME/cmdline-tools/latest/
        mv "$staging/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
        rmdir "$staging" 2>/dev/null || true

        sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
        [[ -x "$sdkmanager" ]] || die "sdkmanager 未就绪"
        log "cmdline-tools 安装完成"
    fi

    # 接受许可并安装组件
    log "安装 Android SDK 组件 (build-tools / platform / ndk)..."
    export ANDROID_HOME
    export ANDROID_SDK_ROOT="$ANDROID_HOME"

    # 预接受所有许可
    yes | "$sdkmanager" --licenses >/dev/null 2>&1 || true

    local pkgs=(
        "platform-tools"
        "build-tools;$BUILD_TOOLS_VERSION"
        "platforms;$ANDROID_PLATFORM"
        "ndk;$NDK_VERSION"
        "cmake;3.22.1"
    )
    run "$sdkmanager" "${pkgs[@]}"

    log "Android SDK 安装完成于: $ANDROID_HOME"
}

# ----------------------------- 步骤：写入 env.sh -----------------------------
write_env_file() {
    mkdir -p "$(dirname "$ENV_FILE")"
    cat > "$ENV_FILE" <<EOF
# 由 build-android-aarch64.sh 生成，source 之可在当前 shell 复用环境
export ANDROID_HOME="$ANDROID_HOME"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="$JAVA_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:\$JAVA_HOME/bin:\$PATH"
EOF
    chmod +x "$ENV_FILE"
    log "已写入环境文件: $ENV_FILE (后续可 \`source $ENV_FILE\` 复用)"
}

# ----------------------------- 步骤：gradle.properties 修补 -----------------------------
patch_gradle_properties() {
    local gp="$PROJECT_ROOT/android/gradle.properties"
    [[ -f "$gp" ]] || die "未找到 $gp"

    # CI 同款处理：删除 Windows 专用的 org.gradle.java.home 行，让 Gradle 使用 JAVA_HOME
    if grep -q '^org.gradle.java.home=' "$gp"; then
        log "移除 gradle.properties 中的 Windows 专用 org.gradle.java.home 行..."
        sed -i '/^org\.gradle\.java\.home=/d' "$gp"
    fi

    # 注入 aapt2 / host 优化（如不存在）
    if ! grep -q '^org.gradle.jvmargs=' "$gp"; then
        printf '\norg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m\n' >> "$gp"
    fi

    # 临时把 ABI 限定为指定值，避免构建不需要的架构
    case "$BUILD_ABI" in
        all) : ;;  # 保持 gradle.properties 默认值
        *)
            if grep -q '^reactNativeArchitectures=' "$gp"; then
                sed -i -E "s|^reactNativeArchitectures=.*|reactNativeArchitectures=$BUILD_ABI|" "$gp"
            else
                printf '\nreactNativeArchitectures=%s\n' "$BUILD_ABI" >> "$gp"
            fi
            log "已将 reactNativeArchitectures 临时设为: $BUILD_ABI"
            ;;
    esac
}

# ----------------------------- 步骤：keystore -----------------------------
setup_keystore() {
    # Release 构建必须有 release keystore；用户未提供则自动生成
    if [[ "$BUILD_VARIANT" = "debug" ]]; then
        log "Debug 构建，使用项目自带 debug.keystore"
        return
    fi

    if [[ -z "$KEYSTORE_PATH" ]]; then
        # 优先复用项目里的 debug.keystore 作为 release 签名（与 CI 行为一致）
        if [[ -f "$PROJECT_ROOT/android/app/debug.keystore" ]]; then
            KEYSTORE_PATH="$PROJECT_ROOT/android/app/debug.keystore"
            KEYSTORE_PASSWORD="android"
            KEY_ALIAS="androiddebugkey"
            KEY_PASSWORD="android"
            warn "未指定 KEYSTORE_PATH，复用 debug.keystore 签名 release 包 (仅供本地测试)"
        else
            KEYSTORE_PATH="$PROJECT_ROOT/android/app/release.keystore"
            log "生成自签名 release keystore: $KEYSTORE_PATH"
            "$JAVA_HOME/bin/keytool" \
                -genkey -v \
                -keystore "$KEYSTORE_PATH" \
                -storepass "$KEYSTORE_PASSWORD" \
                -alias "$KEY_ALIAS" \
                -keypass "$KEY_PASSWORD" \
                -keyalg RSA -keysize 2048 -validity 10000 \
                -dname "CN=lx-lxwalnut, OU=local, O=local, L=local, ST=local, C=CN"
        fi
    fi
    [[ -f "$KEYSTORE_PATH" ]] || die "keystore 不存在: $KEYSTORE_PATH"

    # 写 android/keystore.properties 供 build.gradle 读取
    local kp="$PROJECT_ROOT/android/keystore.properties"
    cat > "$kp" <<EOF
MYAPP_UPLOAD_STORE_FILE=$KEYSTORE_PATH
MYAPP_UPLOAD_STORE_PASSWORD=$KEYSTORE_PASSWORD
MYAPP_UPLOAD_KEY_ALIAS=$KEY_ALIAS
MYAPP_UPLOAD_KEY_PASSWORD=$KEY_PASSWORD
EOF
    chmod 600 "$kp"
    log "已写入 $kp"
}

# ----------------------------- 步骤：npm 依赖 -----------------------------
install_npm_deps() {
    if [[ ! -d "$PROJECT_ROOT/node_modules" ]]; then
        log "node_modules 不存在，执行 npm ci..."
        (cd "$PROJECT_ROOT" && run npm ci)
    else
        info "node_modules 已存在，跳过 npm ci (如需强制重装请删除该目录或加 --clean 后重跑)"
    fi

    # 确保 gradlew 可执行
    chmod +x "$PROJECT_ROOT/android/gradlew"
}

# ----------------------------- 步骤：构建 -----------------------------
build_apk() {
    resolve_java_home
    [[ -n "${JAVA_HOME:-}" ]] || die "构建前未探测到 JAVA_HOME"

    local gradle_task
    case "$BUILD_VARIANT" in
        release) gradle_task="assembleRelease" ;;
        debug)   gradle_task="assembleDebug"   ;;
        *)       die "未知变体: $BUILD_VARIANT" ;;
    esac

    local extra_args=()
    case "$BUILD_ABI" in
        all) : ;;
        *)   extra_args+=("-PreactNativeArchitectures=$BUILD_ABI") ;;
    esac

    info "JAVA_HOME=$JAVA_HOME"
    info "ANDROID_HOME=$ANDROID_HOME"
    info "构建变体=$BUILD_VARIANT  ABI=$BUILD_ABI  任务=$gradle_task"

    cd "$PROJECT_ROOT/android"

    if [[ "$DO_CLEAN" = 1 ]]; then
        run ./gradlew clean
    fi

    # 与 CI 一致：DISABLE_SVG=1（项目内置脚本会读取该变量）
    DISABLE_SVG=1 run ./gradlew "$gradle_task" "${extra_args[@]}" --no-daemon

    cd "$PROJECT_ROOT"
}

# ----------------------------- 步骤：结果输出 -----------------------------
print_result() {
    local out_dir="$PROJECT_ROOT/android/app/build/outputs/apk/$BUILD_VARIANT"
    echo
    log "==================== 构建完成 ===================="
    if [[ -d "$out_dir" ]]; then
        info "产物目录: $out_dir"
        find "$out_dir" -maxdepth 2 -name '*.apk' -printf '  -> %P  (%s bytes)\n' || true
        echo
        info "计算 APK MD5:"
        (cd "$out_dir" && md5sum ./*.apk 2>/dev/null) || true
    else
        warn "未找到产物目录: $out_dir"
    fi
    echo
    info "环境文件: $ENV_FILE"
    info "后续手动重构建示例:"
    echo   "  source $ENV_FILE"
    echo   "  cd $PROJECT_ROOT/android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon"
    echo
}

# ----------------------------- 主流程 -----------------------------
main() {
    echo
    log "项目: lx-lxwalnut-music-mobile"
    log "构建目标: Android APK ($BUILD_VARIANT / $BUILD_ABI) @ aarch64 Ubuntu"
    log "项目根: $PROJECT_ROOT"
    echo

    check_arch

    if [[ "$BUILD_ONLY" = 0 ]]; then
        install_system_deps
        install_node
        install_jdk
        install_android_sdk
        write_env_file
        log "环境安装完成"
    else
        info "跳过环境安装 (--build-only)"
        resolve_java_home
        [[ -n "${JAVA_HOME:-}" ]] || die "未找到 JAVA_HOME，请先去掉 --build-only 执行一次环境安装"
    fi

    if [[ "$SETUP_ONLY" = 1 ]]; then
        log "仅安装模式完成 (--setup-only)"
        return 0
    fi

    patch_gradle_properties
    setup_keystore
    install_npm_deps
    build_apk
    print_result
}

main "$@"
