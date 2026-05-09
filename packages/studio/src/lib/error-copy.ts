const KNOWN_RUNTIME_REPLACEMENTS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly replacement: string;
}> = [
  {
    pattern: /Latest chapter (\d+) is state-degraded\. Repair state or rewrite that chapter before continuing\./g,
    replacement: "최신 $1장이 상태 저하(state-degraded) 상태입니다. 다음 장을 쓰기 전에 상태를 복구하거나 해당 장을 다시 써주세요.",
  },
  {
    pattern: /Chapter (\d+) is not state-degraded\./g,
    replacement: "$1장은 상태 저하(state-degraded) 상태가 아니므로 상태 복구가 필요하지 않습니다.",
  },
  {
    pattern: /Only the latest state-degraded chapter can be repaired safely \(latest is (\d+)\)\./g,
    replacement: "상태 저하(state-degraded) 장은 최신 장만 안전하게 복구할 수 있습니다. 현재 최신 장은 $1장입니다.",
  },
  {
    pattern: /State repair still failed for chapter (\d+)\./g,
    replacement: "$1장 상태 복구가 여전히 실패했습니다.",
  },
  {
    pattern: /Studio LLM API key not set\. Open Studio services and save an API key for the selected service\./g,
    replacement: "Studio LLM API Key가 설정되지 않았습니다. 모델 설정을 열고 현재 서비스의 API Key를 저장하세요.",
  },
  {
    pattern: /INKOS_LLM_API_KEY not set\. Run 'inkos config set-global' or add it to project \.env file\./g,
    replacement: "INKOS_LLM_API_KEY가 설정되지 않았습니다. `inkos config set-global`을 실행하거나 프로젝트 .env 파일에 추가하세요.",
  },
  {
    pattern: /Studio server connection was interrupted\. The request may have been stopped while the server was restarting\. Please try again\./g,
    replacement: "Studio 서버 연결이 중간에 끊겼습니다. 서버가 재시작되는 동안 요청이 중단되었을 수 있습니다. 잠시 후 다시 시도해 주세요.",
  },
];

export function localizeKnownRuntimeMessage(message: string): string {
  let localized = message;
  for (const entry of KNOWN_RUNTIME_REPLACEMENTS) {
    localized = localized.replace(entry.pattern, entry.replacement);
  }
  return localized;
}
