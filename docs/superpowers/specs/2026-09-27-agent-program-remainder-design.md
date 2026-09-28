# Loop agent 개선 프로그램 B–F 설계

기준은 `docs/research/2026-09-27-agent-adoption-program.md`와 네 고정 fixture다. 사용자가 승인한 Pi Lead 한 대화, Herdr worker 탭, 자연어 steering, 완료 뒤 탭 정리 계약을 유지한다.

## B. 작은 작업의 착수

Pi Lead에 단일 구현 작업용 짧은 입력 경로를 둔다. Lead는 의도, 정확한 읽기·쓰기 범위, 확인할 요구와 실행 검사를 직접 적는다. adapter는 generated `TaskSpecInput`을 구성해 기존 Rust graph 제출 경계에 넘긴다. 기본 compute 범위는 설정에서 파생한다. 계약의 검증·소유권 판단은 기존 Rust에 남는다. 다중 작업과 결정·통합은 기존 `loop_run`을 쓴다. B fixture에서 요청→인계와 전체 완료를 비교해 실제 이득을 판단한다.

## C. 변경 요구와 증거

steer 영수증은 원문, 대상, 접수 sequence, worker 전달 watermark, 적용 검사의 상태를 분리한다. 전달 전에는 `기록됨`, watermark가 접수를 포함하면 `전달됨`, 새 기준을 검사한 뒤에만 `검증됨`이라고 표시한다. 검사는 현재 소스 상태와 연결돼야 하며, 수정 경로가 선언한 `writeScope` 안에 있는지 확인한다. 사용자·다른 run의 기존 dirty 변경은 worker의 변경으로 단정하지 않는다. 병행 중인 bridge guidance/coverage 변경이 확정되기 전에는 해당 파일을 덮어쓰지 않는다.

## D. 복구와 쿼터

worker의 오류·검사 실패·quota 실패를 같은 결과로 취급하지 않는다. 검사 실패는 남은 시도에서 수정하고, 소진된 실패는 attention으로 올린다. attention 해결 뒤 owner가 없고 실행 가능 작업이 있으면 재시작한다. 구조화된 Pi 종료 증거와 실제 429 영수증을 확인한 뒤에만 동시성 정책을 조정한다. 오류 표시는 다음 행동을 한 문장으로 알려 준다.

## E. 문맥과 TUI

Pi Lead의 기본 화면은 2줄 진행 위젯이다. worker 목록은 중복 없이 표시하고, 사용자 요청 시 현재 task의 상세·검사·steer 전달 상태를 같은 대화에서 읽는다. 코드 지도는 파일·심볼 요약만 먼저 제공하고 원문은 명시적으로 열 때 읽는다. 큰 출력 artifact는 비밀정보 제거와 저장 성공을 확인한 뒤 경로를 제시한다. 별도 TUI를 만들지 않는다.

## F. 선택적 운영 기능

반복 graph template, 기억, checkpoint, worker 재개는 기본값으로 활성화하지 않는다. 동일 fixture의 성공률·wall time·사용량 영수증으로 이득이 확인되면 작은 실험으로 채택한다. 증거가 없으면 보류와 재검토 조건을 남긴다.

## 완료 기준

각 변경은 실패하는 focused test를 먼저 확인한다. `bun run check`, 실제 Pi/Herdr의 B·C·D fixture, 설정/설치본 동일성을 구분해 기록한다. 단일 호출이나 fake provider 결과로 속도 향상률을 주장하지 않는다.
