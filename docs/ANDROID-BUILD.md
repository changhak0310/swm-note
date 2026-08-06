# 안드로이드 빌드

## 에뮬레이터 실행 (개발)

```bash
pnpm --filter @puri/student-mobile build
cd apps/student-mobile
npx cap run android --target Pixel_Tablet_API_35   # 폰은 Pixel_8_API_35
```

코드 수정 후에는 매번 `build` → `cap run` 순서를 반복해야 반영된다 (웹뷰 앱이라 웹 번들을 다시 넣어야 한다).

## 릴리스 AAB 빌드 (Play 콘솔 업로드용)

```bash
pnpm --filter @puri/student-mobile build
cd apps/student-mobile
npx cap sync android
cd android && ./gradlew bundleRelease
```

산출물: `apps/student-mobile/android/app/build/outputs/bundle/release/app-release.aab`

### 업로드 전 체크리스트

- **versionCode 올리기** — `android/app/build.gradle`의 `versionCode`를 1씩 증가.
  같은 값이면 Play 콘솔이 거부한다.
- **PostHog 키 확인** — `apps/student-mobile/.env.local`에 `VITE_POSTHOG_KEY`가
  있어야 수집이 켜진 번들이 나온다 (빌드 시점에 박힌다).

### 서명

릴리스 서명은 `android/key.properties`(gitignore됨)가 있을 때만 걸린다.

- 키스토어: `android/upload-keystore.jks` — 비밀번호는 `key.properties` 참조
- **둘 다 리포 밖에 백업 필수.** 잃어버리면 앱 업데이트 서명을 못 한다.
- 새 장비에서는 백업해둔 두 파일을 `android/`에 복사하면 된다.
