# 모녀 발자국

엄마와 딸이 함께 쓰는 여행·체험 기록장. 휴대폰 홈 화면에 추가해서 앱처럼 씁니다.

- 화면: `index.html` (앱 전체), `shim.js` (Firebase 연결), `config.js` (Firebase 웹 설정)
- 데이터: Firebase Firestore `families/<가족 키>/...` 아래 (trips, trips/{id}/plan·notes·todo·budget·research, ideas, blobs)
- 가족 키는 가족 링크(`?k=...`)에만 들어 있고 이 저장소에는 없습니다. Firestore 규칙이 그 키 경로만 허용합니다.
- 배포: GitHub Pages (main 브랜치 루트). 파일을 고쳐 main에 올리면 같은 주소에 1~2분 뒤 반영됩니다.
- 백업: 앱 홈의 ‘백업 · 가져오기’에서 JSON으로 저장·복원.
