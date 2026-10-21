/**
 * Every user-facing string in the app (한국어). The herdr vocabulary is
 * spoken verbatim — 워크스페이스·탭·페인·에이전트 and herdr's five-state
 * lifecycle (rebuild brief §3 용어 규율). Loop run/task/attention words do
 * not appear on home or detail surfaces.
 */

export const copy = {
  appName: "Loop",

  // Connection
  connectTitle: "게이트웨이 연결",
  connectHint: "Mac에서 `loop pair`가 만든 QR을 스캔하거나 주소를 직접 입력하세요.",
  connectScan: "QR 스캔",
  connectManual: "주소로 연결",
  connectHostLabel: "호스트 (Tailscale 주소)",
  connectPortLabel: "포트",
  connectCta: "연결",
  connecting: "연결 중…",
  connectFailed: "연결에 실패했어요",
  connectedTo: "연결됨",
  logout: "로그아웃",
  logoutConfirmTitle: "로그아웃",
  logoutConfirmBody: "저장된 연결 정보를 삭제하고 초기 화면으로 돌아갈까요?",

  // Tabs
  tabHerd: "Herd",
  tabPanes: "Panes",
  tabSettings: "설정",

  // Herd home
  herdTitle: "Herd",
  herdEmptyTitle: "실행 중인 에이전트가 없어요",
  herdEmptyBody: "우측 아래 + 버튼으로 워크스페이스에 에이전트를 시작하세요.",
  herdOfflineTitle: "herdr에 연결할 수 없어요",
  herdOfflineBody: "Mac에서 herdr가 실행 중인지 확인하세요. 연결이 복구되면 자동으로 다시 나타나요.",
  herdFailedBody: "게이트웨이에 연결할 수 없어요. 설정에서 연결을 확인하세요.",
  newAgent: "새 에이전트",

  // Agent detail
  paneGoneTitle: "이 페인은 닫혔어요",
  paneGoneBody: "데스크톱에서 닫혔거나 종료된 페인이에요. Herd로 돌아가 다른 에이전트를 보세요.",
  paneGoneBack: "Herd로 돌아가기",
  quickKeyStop: "정지",
  quickKeyCancel: "취소",
  composerPlaceholder: "에이전트에게 메시지 보내기",
  composerSend: "보내기",
  sendQueued: "전송됨 — 응답을 기다리는 중",
  sendBlocked: "에이전트가 승인 대기 중이에요 — Mac에서 확인하세요",
  sendNotFound: "에이전트를 찾을 수 없어요",
  sendFailed: "전송에 실패했어요",
  segmentChat: "대화",
  segmentTerminal: "터미널",
  focusOnDesktop: "Mac에서 열기",
  truncateNotice: "화면에 보이는 최근 내용만 가져왔어요",
  agentStarting: "시작 중…",

  // New agent sheet
  newAgentTitle: "새 에이전트",
  newAgentKindLabel: "종류",
  newAgentWorkspaceLabel: "워크스페이스",
  newAgentNameLabel: "이름 (선택)",
  newAgentStart: "시작",
  newAgentNoIntegrations: "설치된 에이전트가 없어요 — Mac에서 herdr integration install로 추가하세요.",
  newAgentWorkspaceNew: "새 워크스페이스",

  // Panes browser
  panesTitle: "Panes",
  panesEmpty: "열려 있는 페인이 없어요",
  paneShell: "셸",

  // Settings
  settingsTitle: "설정",
  settingsConnection: "연결",
  settingsHerdr: "herdr",
  settingsServerVersion: "서버",
  settingsProtocol: "프로토콜",
  settingsNotConnected: "연결되지 않음",

  // Status pills (herdr lifecycle, verbatim)
  statusWorking: "작업 중",
  statusIdle: "대기",
  statusBlocked: "승인 대기",
  statusDone: "완료",
  statusUnknown: "알 수 없음",
} as const;

export function statusLabel(status: string): string {
  switch (status) {
    case "working":
      return copy.statusWorking;
    case "idle":
      return copy.statusIdle;
    case "blocked":
      return copy.statusBlocked;
    case "done":
      return copy.statusDone;
    default:
      return copy.statusUnknown;
  }
}
