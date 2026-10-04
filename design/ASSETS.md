# 배경 이미지 제작 기록

- 기준 이미지: 프로젝트 루트의 `차분한 하루 플래너 대시보드.png`
- 생성 도구: 내장 `image_gen` 도구, 이미지 편집 방식
- 최종 원본: `design/study-window.png`
- 웹용 배경: `public/study-window.webp`
- 웹용 파일은 Sharp로 WebP 인코딩만 했으며, 구도나 내용을 추가로 바꾸지 않았습니다.
- 다시 압축하려면 `npm run optimize:assets`를 실행합니다.

## 아이콘과 세부 UI 참고

- 추가 참고 이미지: 프로젝트 루트의 `아이콘.png`
- 적용 요소: 선형 메뉴 아이콘, 파란색 홈 활성 상태, 톱니바퀴 설정 아이콘, 원형 추가 버튼, 파란색 완료 체크, 색상 점이 있는 과목 태그
- 참고 이미지에서 아이콘을 잘라 쓰지 않고 Lucide SVG와 CSS로 구현했습니다. 각 아이콘은 버튼의 가운데에 정렬하고, 주요 버튼은 최소 44px 크기로 눌리는 영역을 확보했습니다.
- 청량한 배경 이미지, 반투명 카드와 전체 화면 구도는 기존 디자인을 유지합니다.

## 글꼴과 타이포그래피

본문과 UI에는 [Pretendard 공식 프로젝트](https://github.com/orioncactus/pretendard)의 `pretendard@1.3.9` 가변 다이나믹 서브셋을 사용합니다. `src/main.tsx`에서 패키지의 CSS를 가져오며, 빌드한 WOFF2 파일은 홈페이지와 함께 배포됩니다. 브라우저는 화면에 필요한 글자의 서브셋만 내려받습니다.

| 영역                | 글꼴                | 굵기와 간격                     |
| ------------------- | ------------------- | ------------------------------- |
| 본문, 할 일, 입력란 | Pretendard Variable | 기본 400                        |
| 큰 제목             | Pretendard Variable | 500, 자간 -0.025em, 줄 높이 1.5 |
| 카드 제목           | Pretendard Variable | 600                             |
| 큰 시계             | Pretendard Variable | 250, 숫자 폭 고정               |
| 오늘의 문구         | Pretendard Variable | 300                             |
| Dayly 로고          | Caveat              | 500                             |

홈의 큰 제목은 PC에서 최대 36px, 휴대폰에서는 26px를 사용합니다. 370px 이하 화면은 23px입니다. 날짜는 PC 20px, 휴대폰 17px를 유지합니다.

Pretendard의 SIL Open Font License 원문은 `public/fonts/Pretendard-LICENSE.txt`에 함께 보관하고 배포합니다. Caveat의 라이선스는 `@fontsource/caveat` 패키지를 따릅니다.

## 최종 프롬프트

```text
Use case: precise-object-edit. Asset type: full-screen background photograph for a personal study planner website. Image 1 is the edit target. Remove EVERY UI overlay, all Korean and English text, brand logo, dates, clock digits, sidebar, cards, checkboxes, icons and quote from the supplied image. Reconstruct the underlying photograph naturally. Preserve the exact overall composition and beautiful fresh blue daylight: tall window frame on the right, clear sky with fluffy white clouds, blue sea and distant mountains, leafy plants at edges, bright sunlit desk with laptop at bottom left, open book bottom right, and water glass. Keep large calm sky in the upper left and upper center suitable for overlaying live interface text. Preserve pale sky-blue airy color palette, photorealism, desk objects, window placement and lighting. NO text, NO numbers, NO user interface, NO graphics, NO watermark. Landscape 3:2 composition. This must be the clean underlying photograph, not a new dashboard mockup.
```
