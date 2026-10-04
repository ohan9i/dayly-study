# 배경 이미지 제작 기록

- 기준 이미지: 프로젝트 루트의 `차분한 하루 플래너 대시보드.png`
- 생성 도구: 내장 `image_gen` 도구, 이미지 편집 방식
- 최종 원본: `design/study-window.png`
- 웹용 배경: `public/study-window.webp`
- 웹용 파일은 Sharp로 WebP 인코딩만 했으며, 구도나 내용을 추가로 바꾸지 않았습니다.
- 다시 압축하려면 `npm run optimize:assets`를 실행합니다.

## 최종 프롬프트

```text
Use case: precise-object-edit. Asset type: full-screen background photograph for a personal study planner website. Image 1 is the edit target. Remove EVERY UI overlay, all Korean and English text, brand logo, dates, clock digits, sidebar, cards, checkboxes, icons and quote from the supplied image. Reconstruct the underlying photograph naturally. Preserve the exact overall composition and beautiful fresh blue daylight: tall window frame on the right, clear sky with fluffy white clouds, blue sea and distant mountains, leafy plants at edges, bright sunlit desk with laptop at bottom left, open book bottom right, and water glass. Keep large calm sky in the upper left and upper center suitable for overlaying live interface text. Preserve pale sky-blue airy color palette, photorealism, desk objects, window placement and lighting. NO text, NO numbers, NO user interface, NO graphics, NO watermark. Landscape 3:2 composition. This must be the clean underlying photograph, not a new dashboard mockup.
```
