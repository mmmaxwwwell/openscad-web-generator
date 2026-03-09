plugins {
    id("com.android.application")
}

val buildWebApp by tasks.registering(Exec::class) {
    workingDir = file("${project.rootDir}/..")
    environment("VITE_APK", "1")
    commandLine("node", "scripts/build.mjs")
    inputs.files(fileTree("${project.rootDir}/..") {
        include("src/**", "index.html", "vite.config.ts", "package.json", "public/**")
    })
    outputs.dir("${project.rootDir}/../dist")
}

val copyWebAssets by tasks.registering(Copy::class) {
    dependsOn(buildWebApp)
    from("${project.rootDir}/../dist")
    into("src/main/assets/webapp")
}

tasks.named("preBuild") {
    dependsOn(copyWebAssets)
}

android {
    namespace = "io.github.mmmaxwwwell.openscadweb"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.mmmaxwwwell.openscadweb"
        minSdk = 24
        targetSdk = 35
        versionCode = System.getenv("VERSION_CODE")?.toIntOrNull() ?: 1
        versionName = System.getenv("VERSION_NAME") ?: "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

configurations.all {
    resolutionStrategy {
        force("org.jetbrains.kotlin:kotlin-stdlib:1.8.22")
        force("org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.8.22")
        force("org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.8.22")
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
}
