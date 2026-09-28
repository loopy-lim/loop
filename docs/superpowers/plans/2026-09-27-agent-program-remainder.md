# Agent 개선 프로그램 B–F 실행 계획

1. B/C fixture를 깨끗한 독립 worktree에서 실행해 요청→인계, 검사 완료, worker 수와 실패를 기록한다. 기존 A/D 결과와 같은 조건인지 명시한다.
2. 단일 작업의 짧은 Pi 제출 경로와 입력 검사를 실패하는 테스트에서 구현한다. generated protocol을 사용하고 Rust graph 정책은 그대로 둔다. focused test와 B fixture로 평가한다.
3. 현재 guidance/coverage 브리지 변경의 상태를 확인한다. 접수·전달 상태 조회와 검사 연결을 실패하는 테스트에서 구현한다. 실제 D steering에서 원문→worker→검사 순서를 확인한다.
4. 재시도·attention→owner 재시작을 end-to-end로 재현한다. 구조화 Pi 종료와 429 증거를 조사하고, 확인된 결함만 고친다.
5. Pi Lead의 상세 조회·worker 중복 제거와 문맥 요약의 필요한 범위를 구현한다. 기본 위젯 2줄, status 8줄, attention 6줄, findings 5줄을 지킨다.
6. F 후보를 영수증으로 판정하고 채택/보류를 기록한다. 마지막에 `bun run check`, Node bundle/설치본, 실제 TUI를 검증한다.

병행 dirty 파일은 소유하지 않는다. Rust bridge 형식 변경이 필요하면 Rust→codegen→generated 변경을 한 묶음으로 처리한다. 유료 모델 호출은 단위 검사에 넣지 않는다.
