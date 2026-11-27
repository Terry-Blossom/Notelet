import java.io.File
import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// リリース署名: 環境変数（CI）優先、なければ src-tauri/keystore/keystore.properties（ローカル）。
val keystoreDir = file("../../../keystore")
val keystoreProperties = Properties().apply {
    val propFile = File(keystoreDir, "keystore.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}
val releaseStorePath: String? = System.getenv("NOTELET_KEYSTORE_FILE")
    ?: keystoreProperties.getProperty("storeFile")?.let { File(keystoreDir, it).absolutePath }
val hasReleaseKeystore = releaseStorePath != null && file(releaseStorePath).exists()

android {
    compileSdk = 36
    namespace = "app.notelet.desktop"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "app.notelet.desktop"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
        resourceConfigurations += listOf("ja", "en")
    }
    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                storeFile = file(releaseStorePath!!)
                storePassword = System.getenv("NOTELET_KEYSTORE_PASSWORD")
                    ?: keystoreProperties.getProperty("storePassword")
                keyAlias = System.getenv("NOTELET_KEY_ALIAS")
                    ?: keystoreProperties.getProperty("keyAlias")
                keyPassword = System.getenv("NOTELET_KEY_PASSWORD")
                    ?: keystoreProperties.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            // CI では署名鍵が無い場合に debug 署名へフォールバックせずビルドを失敗させる。
            if (hasReleaseKeystore) {
                signingConfig = signingConfigs.getByName("release")
            } else if (System.getenv("CI") == "true") {
                throw IllegalStateException(
                    "リリース署名鍵がありません。NOTELET_KEYSTORE_FILE / NOTELET_KEYSTORE_PASSWORD / NOTELET_KEY_ALIAS / NOTELET_KEY_PASSWORD を設定してください。"
                )
            } else {
                signingConfig = signingConfigs.getByName("debug")
            }
            optimization {
               enable = true
            }
            isShrinkResources = true
            packaging {
                jniLibs {
                    useLegacyPackaging = true
                }
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
