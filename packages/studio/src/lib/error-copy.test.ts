import { describe, expect, it } from "vitest";
import { localizeKnownRuntimeMessage } from "./error-copy";

describe("localizeKnownRuntimeMessage", () => {
  it("localizes the state-degraded continuation blocker", () => {
    expect(localizeKnownRuntimeMessage(
      "Latest chapter 1 is state-degraded. Repair state or rewrite that chapter before continuing.",
    )).toBe("최신 1장이 상태 저하(state-degraded) 상태입니다. 다음 장을 쓰기 전에 상태를 복구하거나 해당 장을 다시 써주세요.");
  });

  it("localizes related state repair errors while preserving unknown messages", () => {
    expect(localizeKnownRuntimeMessage("Chapter 3 is not state-degraded.")).toBe(
      "3장은 상태 저하(state-degraded) 상태가 아니므로 상태 복구가 필요하지 않습니다.",
    );
    expect(localizeKnownRuntimeMessage(
      "Only the latest state-degraded chapter can be repaired safely (latest is 5).",
    )).toBe("상태 저하(state-degraded) 장은 최신 장만 안전하게 복구할 수 있습니다. 현재 최신 장은 5장입니다.");
    expect(localizeKnownRuntimeMessage("Bad request")).toBe("Bad request");
  });

  it("localizes common LLM configuration errors", () => {
    expect(localizeKnownRuntimeMessage(
      "Studio LLM API key not set. Open Studio services and save an API key for the selected service.",
    )).toBe("Studio LLM API Key가 설정되지 않았습니다. 모델 설정을 열고 현재 서비스의 API Key를 저장하세요.");
    expect(localizeKnownRuntimeMessage(
      "INKOS_LLM_API_KEY not set. Run 'inkos config set-global' or add it to project .env file.",
    )).toBe("INKOS_LLM_API_KEY가 설정되지 않았습니다. `inkos config set-global`을 실행하거나 프로젝트 .env 파일에 추가하세요.");
  });
});
