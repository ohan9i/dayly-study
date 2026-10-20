# 플래너 색상과 LiquidChrome 배경

## 공통 UI

- 아침: 따뜻한 종이색 표면, 차콜 기본 버튼, 스톤 보조 버튼과 테두리 버튼.
- 밤: 따뜻한 다크 그레이 표면, 아이보리 기본 버튼, 짙은 스톤 보조 버튼.
- 기록 입력창, 선택된 항목, 진행률 바와 링, 달력, 설정 및 이력 창도 같은 색상 변수를 사용한다.
- UI 문구의 중간점은 조사, 쉼표, 콜론으로 교체한다. 사용자가 이미 작성한 내용은 수정하지 않는다.
- 체크칸은 전체 계획 22px, 세부 계획과 편집창 20px, 모서리 5px로 맞춘다. 클릭 영역은 별도로 유지한다.
- 밀기 메뉴는 92px 영역 안에 14px 아이콘과 12px 글자의 가로형 버튼을 배치한다.
- 휴지통, 최종 복제, 최종 이동은 기존 2초 누르기와 취소 동작을 유지한다.

## shadcn 구성

기존 Vite / React / TypeScript 구조에 Tailwind CSS Vite 플러그인과 shadcn 설정을 추가했다.
기존 화면의 기본 스타일을 보존하기 위해 Tailwind Preflight는 불러오지 않는다.

- 공통 버튼: `src/components/ui/button.tsx`
- 버튼 스타일 연결: `src/components/ui/button.css`
- 클래스 병합: `src/lib/utils.ts`
- Tailwind 테마: `src/tailwind.css`
- 프로젝트 설정: `components.json`
- `@`는 `src`를 가리킨다. 따라서 `@/components/ui/button`은 권장 `components/ui` 경로와 동일하게 해석된다.

버튼은 전달받은 shadcn의 variant, size, asChild, ref 및 네이티브 버튼 속성을 지원한다.
주요 동작과 한 줄 추가, 복제, 이동에 공통 버튼을 사용한다.
HoldButton도 같은 Button을 사용하되 기존의 길게 누르기 동작을 유지한다.

설정 참고: [Tailwind Vite](https://tailwindcss.com/docs/installation/using-vite),
[Preflight 선택 적용](https://tailwindcss.com/docs/preflight),
[shadcn Button](https://ui.shadcn.com/docs/components/button).

## LiquidChrome

사용자가 제공한 React Bits LiquidChrome 코드를 TypeScript로 옮겼다.
기존 구름 영상과 포스터, 재생 코드를 제거했다. 별도 그래픽 의존성과 외부 이미지 요청은 없다.
코드의 라이선스는 `docs/licenses/ReactBits-LICENSE.md`에 보존되어 있다.

- 첫 책 애니메이션이 끝난 뒤 플래너 홈 배경에만 캔버스를 생성한다.
- 플래너 카드와 기록창은 불투명한 표면을 유지하며 배경은 입력과 밀기 동작을 가로채지 않는다.
- 기본 흐름: speed 0.11, amplitude 0.2, detail 5, thickness 1.55, frequency 3.2 / 1.5, depth 0.65.
- 낮과 밤에 맞춘 금속색과 표면색 베일을 적용한다.
- 렌더링은 최대 30fps, 약 240만 픽셀, DPR 1.5로 제한한다.
- 배경용이므로 커서 파문은 사용하지 않고 불필요한 유체 시뮬레이션을 생략한다.
- 숨긴 탭, 화면 밖, 모달이 열린 동안 렌더링을 중지한다.
- 실시간 동작 줄이기 및 데이터 절약 설정에서는 정지 화면을 그린다.
- WebGL 미지원 시 정적 그라데이션을 표시하며 컨텍스트 손실 및 복구를 처리한다.

## 검증

- TypeScript 및 Vite 프로덕션 빌드.
- 단위 테스트 72개.
- 기존 체크, 밀기 추가/삭제, 2초 누르기, 기록 저장, 복제, 공간 이동, 설정 이력 시나리오.
- 낮과 밤, 320px 모바일부터 1920px 데스크톱까지 화면 배치와 실제 배경 픽셀의 글자 대비.
- LiquidChrome 전용 테스트: 책 진입 시점, 실제 GPU 그리기, 탭/모달 정지, 동작 줄이기, 데이터 절약, WebGL 미지원, 컨텍스트 복구.
