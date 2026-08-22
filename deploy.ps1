# 좋아하는 구석 — 배포 한 방
#
#   .\deploy.ps1                  기본 메시지로 배포
#   .\deploy.ps1 "그래프 색 수정"   메시지 지정
#   .\deploy.ps1 -Check           배포하지 않고 상태만 확인
#
# 하는 일: sw.js 버전 자동 갱신 → git 커밋 → push.
# 주소는 바뀌지 않는다. 사진·메모는 각 기기 안에 있으므로 배포와 무관하다.

param(
  [Parameter(Position = 0)]
  [string]$Message = "",
  [switch]$Check
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Say($t) { Write-Host $t }

# ── 1. 필수 파일 확인 ──────────────────────────────────────
$required = @("index.html", "manifest.webmanifest", "sw.js",
              "icons/icon-192.png", "icons/icon-512.png",
              "icons/icon-maskable-512.png", "icons/apple-touch-icon-180.png")
$missing = $required | Where-Object { -not (Test-Path $_) }
if ($missing) {
  Say "✗ 배포에 필요한 파일이 없습니다:"
  $missing | ForEach-Object { Say "    $_" }
  exit 1
}

# ── 2. 서비스 워커 버전 자동 갱신 ──────────────────────────
Say "▸ 버전 확인"
node tools/sync-version.mjs
if ($LASTEXITCODE -ne 0) { Say "✗ 버전 갱신 실패. 배포를 멈춥니다."; exit 1 }

# ── 3. git ────────────────────────────────────────────────
if (-not (Test-Path ".git")) {
  Say ""
  Say "아직 git 저장소가 아닙니다. 처음 한 번만 아래를 실행하세요:"
  Say ""
  Say "    git init"
  Say "    git add ."
  Say "    git commit -m `"좋아하는 구석 PWA`""
  Say "    git branch -M main"
  Say "    git remote add origin <레포주소>"
  Say "    git push -u origin main"
  Say ""
  Say "그 다음부터는 .\deploy.ps1 한 줄이면 됩니다."
  exit 0
}

$dirty = git status --porcelain
if (-not $dirty) {
  Say "· 바뀐 게 없습니다. 배포할 것이 없어요."
  exit 0
}

Say ""
Say "▸ 바뀐 파일"
git status --short | ForEach-Object { Say "    $_" }

if ($Check) {
  Say ""
  Say "· -Check 모드라 여기서 멈춥니다. 실제로 올리려면 인자 없이 다시 실행하세요."
  exit 0
}

if (-not $Message) {
  $Message = "리뉴얼 " + (Get-Date -Format "yyyy-MM-dd HH:mm")
}

Say ""
Say "▸ 커밋 · 푸시"
git add -A
git commit -m $Message
if ($LASTEXITCODE -ne 0) { Say "✗ 커밋 실패"; exit 1 }

$hasRemote = git remote
if (-not $hasRemote) {
  Say ""
  Say "· 커밋은 됐지만 remote 가 없어 push 는 건너뜁니다."
  Say "  git remote add origin <레포주소> 후 git push -u origin main"
  exit 0
}

git push
if ($LASTEXITCODE -ne 0) { Say "✗ push 실패"; exit 1 }

Say ""
Say "✓ 배포 완료. GitHub Pages 는 1~2분 뒤 반영됩니다."
Say "  주소는 그대로이고, 각 기기의 사진·메모도 그대로입니다."
