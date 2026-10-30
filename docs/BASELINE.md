# BASELINE

> Berkas ini sudah ada di cabang `chore/sesi-0-baseline` (hasil pemeriksaan Sesi 0). Di cabang ini hanya bagian Android yang dicatat (Sesi 7); saat cabang digabung, satukan dengan bagian Android di sana.

## Android (Sesi 7: kompilasi dan tes)

Tanggal uji: 2026-10-30, Windows 11 x64.

| Hal | Nilai |
| --- | --- |
| JDK yang berhasil | **JBR 21.0.11** (`C:\Users\<pengguna>\.jdks\jbr-21.0.11`), dipakai sebagai `JAVA_HOME` |
| JDK yang gagal | JBR 25.0.3 bawaan Android Studio (`C:\Program Files\Android\Android Studio\jbr`). Gradle 8.13 berjalan, tetapi build berhenti dengan pesan `25.0.3`: Kotlin 2.0.21 tidak bisa membaca string versi JDK 25 |
| Gradle / AGP / Kotlin / KSP | 8.13 (wrapper) / 8.9.1 / 2.0.21 / 2.0.21-1.0.28 (tidak diubah) |
| Compose BOM | 2025.05.00 |
| Android SDK | `%LOCALAPPDATA%\Android\Sdk`: platform `android-36` dan `android-37.0`, build-tools 35.0.0 dan 36.0.0; `compileSdk`/`targetSdk` 36, `minSdk` 26 |
| Emulator | AVD `Medium_Phone_API_37.0` (Android 17), dijalankan headless dengan `-gpu swiftshader_indirect` |

### Perintah

Dari `apps/android`, dengan `JAVA_HOME` menunjuk ke JDK 17 sampai 21 (di Windows, dari `cmd`: `set JAVA_HOME=C:\Users\<pengguna>\.jdks\jbr-21.0.11` lalu `gradlew.bat ...`):

```
gradlew.bat --offline :app:assembleDebug :app:testDebugUnitTest   # varian debug + tes unit JVM
gradlew.bat :app:ktlintFormat :app:ktlintCheck :app:detekt         # gaya dan analisis statis
gradlew.bat :app:assembleDebugAndroidTest                          # kompilasi tes instrumentasi
gradlew.bat :app:connectedDebugAndroidTest                         # butuh emulator/perangkat
```

### Perbaikan bila gagal karena lingkungan

- Pesan build hanya `25.0.3` (atau versi JDK lain di atas 21): `JAVA_HOME` menunjuk ke JDK terlalu baru. Pasang atau pakai JDK 17 sampai 21 (JBR 21 dari Android Studio: Settings > Build Tools > Gradle > Gradle JDK > Download JDK, atau folder `~/.jdks`).
- `java` tidak ditemukan: set `JAVA_HOME`; Gradle tidak memakai `java` dari PATH bila `JAVA_HOME` benar.
- `SDK location not found`: buat `apps/android/local.properties` berisi `sdk.dir=...` ke folder Android SDK.
- Jangan menaikkan Gradle, AGP, atau Kotlin tanpa izin; versi di atas adalah yang teruji.
