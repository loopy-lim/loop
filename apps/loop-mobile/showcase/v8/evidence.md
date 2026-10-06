# v8 Release 시뮬레이터 캡처 — 방향 A

- 조건: iPhone 17 / iOS 26.2 (UDID `99B087B5-DEF6-4CF1-9177-81A5DE564CFC`), 1206×2622 px, 3×. `apps/loop-mobile/scripts/build-ios-simulator.sh` Release 빌드 성공 후 설치된 `org.reactjs.native.example.LoopMobile`을 `xcrun simctl io booted screenshot`으로 촬영. 로컬 가짜 attention gateway `attention-demo-gateway.ts` (`127.0.0.1:18611`) 사용; 유료 모델 호출 없음. 로그인 상태는 이전 시뮬레이터 세션의 로컬 상태였으며 연결 화면은 앱의 로그아웃 확인 UI를 거쳐 캡처. 샘플 호스트는 연결 화면의 앱 기본 입력값이며 비밀 토큰은 화면에 없음.
- UI 조작: Simulator 접근성 그룹 `(755,131) 346×753`에 대응하는 cliclick 실제 클릭. 런 목록 → attention 카드 → 대화 상세 → 뒤로 → Files 탭 → attention 입력에 타이핑. API로 attention resolve를 강제하지 않음.

| 파일 | 확인한 화면 | 판정 |
| --- | --- | --- |
| `01-connect.png` | 로그아웃 후 연결 양식 / 단일 Connect CTA | 연결 화면 확인 |
| `02-runs-list.png` | attention 런 목록, 하단 Chats·Files·Settings 탭 | 새 전체 폭 탭 바 확인 (기존 하단 pill 아님) |
| `03-run-detail.png` | 선택한 런의 대화 상세 헤더와 composer | **부분 확인**: 데모 gateway에 연결된 세션이 없어 `Connecting to this task's session` 상태; 대화 내용·툴 카드는 이 컷에서 확인 불가 |
| `05-files-attention.png` | Files 탭의 런 상세, worker 질문과 비활성 제출 버튼 | 질문·응답 입력 확인 |
| `06-attention-ready.png` | 응답 입력 후 활성화된 Submit response CTA / 하단 탭 | **부분 확인**: cliclick 하드웨어 키보드 입력이 한글 자판으로 해석되어 영어 지시문이 깨짐. 제출은 하지 않았고 resolution 성공은 주장하지 않음 |

## 토큰 픽셀 분석

방법: Pillow로 모든 PNG를 RGB로 디코딩하여 전체 `1206×2622` 픽셀의 **정확 일치** 비율을 계산. `src/ui/tokens.ts` v2 매핑: bg `#0B0E13`, surface `#12161E`, surfaceAlt `#181D27`, cta `#F2F5F9`, accent `#7C89E8`, warn `#D29922`. 텍스트 안티앨리어싱·반투명 합성은 정확 일치에 포함되지 않으므로 수치는 하한 추정이며 형태·터치 영역·WCAG 대비를 픽셀 비율만으로 증명하지 않는다.

| 화면 | bg | surface | surfaceAlt | cta | accent | warn |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 연결 | 73.60% | 16.85% | 0.00% | 5.94% | 0.00% | 0.00% |
| 목록/탭 | 66.10% | 29.06% | 0.00% | 0.29% | 0.03% | 0.16% |
| 대화 상세(연결 중) | 91.38% | 5.74% | 0.00% | 0.16% | 0.00% | 0.00% |
| attention 상세 | 75.07% | 12.10% | 4.33% | 0.80% | 0.02% | 0.23% |
| attention 입력 후 | 72.86% | 12.25% | 6.21% | 5.23% | 0.24% | 0.24% |

**판정:** 다크 배경/표면 계층과 단일 밝은 CTA는 연결 및 attention 입력 후 컷에서 확인된다. 비활성 상태에서 밝은 CTA 영역이 0.80%→입력 후 5.23%로 증가한다. 목록의 accent 0.03%, warn 0.16%로 상태색은 화면의 큰 채움이 아니며, 새 하단 탭 바는 accent 선택 상태를 표시한다. 카드 경계는 어두운 표면과 얇은 선으로 표현된다. **미확인:** 실제 런 대화 내용과 정상 영문 attention 제출 성공, 접근성·동작 범위 전체. v7 `showcase/v7/restyle/`와 시각 비교 시 기존 하단 두 pill 대신 새 3열 탭 바가 나타나며 배경/표면 색이 v2로 바뀌었다.

## React Doctor

`docs/design/audits/react-doctor-report-v8.txt`: `npx -y react-doctor@latest apps/loop-mobile --verbose` 원본 출력, exit 1, 점수 46/100 Critical, 173건(11 errors, 162 warnings). **권고:** error부터 처리. `eslint/no-unused-vars`(3), React Native core에서 제거된 모듈 import(1), render 중 ref 변경(4), 정리되지 않은 effect subscription/timer(1), 스크롤 핸들러 setState(2)를 각 진단 위치에서 재현·수정하고 재실행한다. 이 verification 작업은 코드 수정 권한이 없으므로 미해결로 남긴다.
