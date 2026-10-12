# 삭제 이력과 정기 백업

## 제공되는 보호

- `tasks`, `task_notes`, `task_attachments`의 **성공한 DELETE**마다 서버가 삭제된 내용, 시각, 로그인 계정 UUID와 DB 역할을 남긴다. 트랜잭션이 롤백되면 삭제 이력도 롤백되어 실제 삭제와 구분된다.
- 계획 삭제 전 서버가 계획·기록·완료 상태·첨부 목록을 보존한다. 정리 중 다른 창에서 계획이 수정되면 오래된 삭제 요청은 중단한다. 보호 SQL이 없거나 이력 트리거가 꺼져 있으면 새 앱은 원본 파일 정리 전에 삭제를 중단한다.
- 현재 공간의 소유자, 계획 작성자 또는 기록 작성자는 **현재 공유 권한이 유지되는 범위**에서 관련 삭제 이력을 열람한다. 브라우저 계정은 이력을 추가·수정·삭제할 권한이 없다. 계정·공간 삭제로 이력이 함께 사라지지 않게 이력 테이블에는 cascading FK를 두지 않았다.
- 설정의 **기록 보호**에서 최근 이력 50건과 마지막 성공 백업 시각을 확인하고, 개별 삭제 이력을 JSON으로 내려받는다.
- GitHub Actions가 매일 **03:00 Asia/Seoul**에 백업한다. GitHub의 실행 대기 때문에 실제 시작은 늦어질 수 있다. 암호화된 Artifact의 보관 기간은 30일이며, 서버 삭제 이력에는 자동 보관 만료를 두지 않는다.

## 운영 설치

기존 migration 다음에 `supabase/migrations/20261013_deletion_history_and_backups.sql` 전체를 SQL Editor에서 실행한다. 하나의 트랜잭션이며 다시 실행할 수 있다. 기존 계획을 삭제하거나 권한을 다른 계정으로 이전하지 않는다.

GitHub repository Secret `SUPABASE_BACKUP_SECRET_KEY`에는 Supabase의 서버용 `sb_secret_…` 키를 넣는다. 기존 `service_role` JWT도 지원한다. 공개/publishable/anon 키는 코드에서 거부한다. 이 키는 브라우저나 `VITE_` 변수, 저장소 파일에 넣지 않는다. 서버 백업용 두 RPC는 `service_role`에만 실행 권한을 준다. [Supabase API 키](https://supabase.com/docs/guides/getting-started/api-keys), [DB 함수 권한](https://supabase.com/docs/guides/database/functions)

암호화 키 최초 설정:

```powershell
node scripts/setup-backup-key.mjs ohan9i/dayly-study
```

공개 키만 GitHub repository Variable `DAYLY_BACKUP_PUBLIC_KEY`에 올라간다. 개인 키는 `.local/backup-keys/private-key.dpapi`에 Windows 계정으로 보호해 저장하며 Git에는 포함되지 않는다. 이미 다른 공개 키가 설정된 경우 자동으로 교체하지 않는다.

Actions의 `Encrypted daily planner backup`을 수동 실행한다. 암호화 파일 업로드와 서버 성공 기록을 확인한 뒤 `DAYLY_BACKUPS_ENABLED=true` repository Variable을 설정하면 정기 실행이 활성화된다. 초기에는 정기 실행이 비활성화되어, 설정이 끝나기 전 실패하는 예약 작업이 반복되지 않는다.

## 백업의 내용과 성공 판정

`create_planner_backup_snapshot()`의 한 SELECT가 공간·승인·계획·완료·기록·첨부·변경 번호·삭제 이력·삭제 준비본의 논리 스냅샷을 만든다. 이어서 업로드 완료(`ready`) 상태의 첨부 원본을 내려받는다. 파일이 내려받아지지 않거나 크기가 다르면 백업을 실패 처리하고 새 성공 기록을 남기지 않는다. 동시 삭제로 파일이 누락된 경우 변경이 끝난 뒤 다시 실행한다.

각 백업은 새 AES-256-GCM 키와 IV로 압축·암호화한다. 그 일회용 키는 RSA-3072 공개 키로 감싸며, 복호화용 개인 키는 GitHub에 없다. 파일별 SHA-256도 백업 안에 기록한다. 업로드할 대상은 `backup-output/planner.dayly.enc` 하나뿐이다. Secret, `.env`, 개인 키, 평문 데이터 파일은 Artifact에 넣지 않는다.

GitHub Artifact 업로드가 성공해 Artifact ID가 발급된 **다음** `complete_planner_backup()`을 호출한다. 암호화 파일 생성만으로 성공 시각을 갱신하지 않는다. 실패·비활성화는 Actions에서 확인하며 설정 화면은 성공 기록이 없거나 26시간 넘게 오래된 경우 안내한다. [Artifact 보관 기간](https://github.com/actions/upload-artifact)

## 복구 파일 확인

Actions 실행의 Artifact를 내려받아 압축을 풀면 `planner.dayly.enc`가 나온다. 원래 Windows 계정에서 다음 명령으로 새 폴더에 복호화한다.

```powershell
node scripts/restore-backup.mjs '.\planner.dayly.enc' '.\.local\backup-keys\private-key.dpapi' '.\.local\recovered-backup'
```

이 도구는 인증 태그 검증이 끝난 뒤 파일 경로를 읽는다. 변조, 잘못된 키, 경로 탈출, 기존 출력 폴더 덮어쓰기를 거부한다. `database.json`과 `storage/task-files/...` 원본이 생성되며 운영 DB를 자동 변경하지 않는다. 관리자가 필요한 계획과 관련 행을 확인해 기존 계정·공간 ID와 대조한 뒤 복원한다. 전체 프로젝트를 과거 상태로 덮어쓰는 동작은 하지 않는다.

### 컴퓨터 교체 대비

DPAPI 키는 원래 Windows 계정/환경에 연결된다. 다른 컴퓨터에서도 복구하려면 교체 전에 비밀번호로 암호화한 휴대용 키를 내보내 안전한 장소에 따로 보관한다. 비밀번호와 키 파일은 별도로 보관한다.

```powershell
$OutputEncoding = [System.Text.UTF8Encoding]::new()
$keyPassword = Read-Host '휴대용 복구 키 비밀번호 (16자 이상)' -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($keyPassword)
try {
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer) | node scripts/export-backup-key.mjs '.\.local\backup-keys\private-key.dpapi' '.\.local\backup-keys\private-key.portable.pem'
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
  Remove-Variable keyPassword,keyPointer
}
```

휴대용 키로 복호화할 때도 같은 로컬 비밀번호 입력 방식으로 `node scripts/restore-backup.mjs <백업> <휴대용키.pem> <새출력폴더> --passphrase-stdin`에 입력을 파이프로 전달한다. 키의 비밀번호를 명령줄 인자나 채팅에 쓰지 않는다.

## 한계

설치 전 삭제된 계획을 소급해 만들지는 못한다. 이력 JSON에는 첨부 목록이 있지만 원본 바이트는 없으므로, 파일 원본에는 삭제 전의 정기 백업이 필요하다. 첫 백업 전에 생성·삭제된 첨부의 원본까지 보장하지는 않는다. 일일 백업 사이에 작성된 내용은 삭제 이력으로 보존된 범위에서 확인한다.

이것은 플래너 데이터와 완료된 첨부의 논리 백업이며, Supabase Auth 계정·비밀번호·전체 DB 설정의 재해 복구 백업은 아니다. `TRUNCATE`, `DROP`, 트리거를 끈 관리자 작업은 DELETE 이력으로 잡히지 않으며, 삭제된 프로젝트 자체를 되살리는 기능도 아니다. 기존 삭제를 되돌리는 휴지통 UI는 포함하지 않는다.

## 검증

PGlite에서 실제 SQL을 실행해 접근 차단, 삭제 스냅샷, 롤백, 변경된 계획의 삭제 거부, 관리자 DELETE, 이력 수정·삭제 차단, 서버 전용 백업과 성공 기록을 검사한다. 암호화 테스트는 실제 압축·암호화·복호화를 실행해 계획 내용과 첨부 바이트, 변조 및 경로 탈출 차단, 실패한 백업의 성공 기록 방지를 검사한다. 브라우저 검사는 실제 SDK와 모의 API로 삭제 이력 다운로드와 보호 설정이 없을 때 원본 보존을 확인한다.
