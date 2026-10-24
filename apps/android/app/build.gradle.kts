import org.gradle.api.tasks.testing.logging.TestExceptionFormat
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ktlint)
    alias(libs.plugins.detekt)
}

// Push FCM opsional: plugin hanya aktif bila app/google-services.json ada (berkas itu rahasia proyek Firebase
// dan tidak di-commit). Tanpa berkas itu aplikasi tetap dibangun dan jalan, hanya tanpa push.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "app.aios.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.aios.android"
        minSdk = 26
        targetSdk = 36
        // CI mengisi keduanya: versionCode naik di setiap build (Android hanya memasang menimpa bila kodenya lebih
        // tinggi), versionName dari tag rilis. Build lokal memakai nilai bawaan.
        versionCode = providers.gradleProperty("aiosVersionCode").orNull?.toInt() ?: 100
        versionName = providers.gradleProperty("aiosVersionName").getOrElse("1.0.1")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Alamat gateway tertanam: layar login tidak meminta alamat. Kosongkan (-PaiosGatewayUrl=) agar alamat
        // diketik saat login, mis. untuk E2E atau gateway lokal.
        val gatewayUrl = providers.gradleProperty("aiosGatewayUrl")
            .orElse(providers.environmentVariable("AIOS_GATEWAY_URL"))
            .getOrElse("https://ai.ojixx.my.id")
        buildConfigField("String", "GATEWAY_URL", "\"$gatewayUrl\"")
    }

    // Penandatanganan rilis opsional: aktif hanya bila keystore diberikan lewat variabel lingkungan (CI memasangnya
    // dari secret). Tanpa itu, APK release tidak bertanda tangan dan tidak bisa dipasang; pakai assembleDebug.
    val releaseKeystore = System.getenv("ANDROID_KEYSTORE_FILE")
    if (releaseKeystore != null) {
        signingConfigs {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            if (releaseKeystore != null) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
        // Pesan assertion lengkap (expected/was) tampil di console saat tes gagal.
        unitTests.all { test ->
            test.testLogging {
                events("failed")
                exceptionFormat = TestExceptionFormat.FULL
            }
        }
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

// Tanpa toolchain: JDK mana pun yang menjalankan Gradle (mis. JBR bawaan Android Studio) boleh dipakai,
// bytecode tetap Java 17.
kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

/*
 * Token desain berasal dari packages/ui-tokens (dibangkitkan dari tokens.json). File Kotlin-nya disalin
 * ke build/ saat build supaya satu-satunya sumber tetap paket itu, bukan salinan yang diedit tangan.
 */
val tokensDir = layout.buildDirectory.dir("generated/aios/tokens")
val syncUiTokens by tasks.registering(Sync::class) {
    from(rootProject.file("../../packages/ui-tokens/Tokens.kt"))
    into(tokensDir)
}
// Direktori (bukan task) sebagai sumber; ketergantungan task dipasang eksplisit di bawah.
android.sourceSets.getByName("main").java.srcDir(tokensDir)
val dependsOnTokens = listOf("ksp", "compile", "lint", "generate", "detekt")
tasks.configureEach {
    val needsTokens = dependsOnTokens.any { name.startsWith(it) } || name.contains("ktlint", ignoreCase = true)
    if (this !== syncUiTokens && needsTokens) {
        dependsOn(syncUiTokens)
    }
}

ktlint {
    android.set(true)
    filter {
        exclude { it.file.invariantSeparatorsPath.contains("/build/") }
    }
}

detekt {
    buildUponDefaultConfig = true
    config.setFrom(rootProject.file("config/detekt.yml"))
    source.setFrom("src/main/kotlin", "src/test/kotlin", "src/debug/kotlin", "src/release/kotlin")
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    implementation(libs.okhttp)
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    implementation(libs.androidx.datastore.preferences)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.tink.android)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.turbine)

    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.rules)
    androidTestImplementation(libs.androidx.test.runner)
    // Espresso lama (3.5.x) gagal di Android 16+ (InputManager.getInstance dihapus); Compose test memakainya.
    androidTestImplementation(libs.androidx.espresso.core)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
