import com.android.build.api.artifact.SingleArtifact
import org.w3c.dom.Element
import java.util.Properties
import javax.xml.parsers.DocumentBuilderFactory

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The upload keystore lives on the owner's machine, never in git. Copy
// keystore.properties.example to keystore.properties and point it at yours.
val keystorePropsFile = rootProject.file("keystore.properties")
val hasKeystoreProps = keystorePropsFile.exists()
val keystoreProps =
    Properties().apply {
        if (hasKeystoreProps) keystorePropsFile.inputStream().use { load(it) }
    }

android {
    namespace = "app.tryatoms.capture"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.tryatoms.capture"
        minSdk = 26
        targetSdk = 35
        versionCode = 3
        versionName = "0.3.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // Where the build is going decides how it reaches the vault, so it is a
    // flavor and not a setting: play can only ever use the folder picker.
    flavorDimensions += "distribution"
    productFlavors {
        create("play") {
            dimension = "distribution"
            // Store build. SAF folder picker only — Play grants all-files access
            // to file managers, backup, and antivirus apps, and nothing else.
        }
        create("sideload") {
            dimension = "distribution"
            // Direct install. Keeps MANAGE_EXTERNAL_STORAGE and the file-tree
            // scan that finds vaults without the user pointing at a folder.
            versionNameSuffix = "-sideload"
        }
    }

    signingConfigs {
        create("release") {
            if (hasKeystoreProps) {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig =
                if (hasKeystoreProps) signingConfigs.getByName("release") else null
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.3")
    implementation("androidx.lifecycle:lifecycle-service:2.8.3")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("androidx.glance:glance-appwidget:1.1.0")
    implementation("androidx.glance:glance-material3:1.1.0")

    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlin:kotlin-test")
}

/**
 * The play flavor exists to not have all-files access, and a permission can come
 * back from a merged library manifest as easily as from ours. So this reads the
 * *merged* manifest rather than the source, and runs before the artifact ships.
 */
abstract class VerifyPlayManifest : DefaultTask() {
    @get:InputFile
    abstract val mergedManifest: RegularFileProperty

    @TaskAction
    fun verify() {
        val banned =
            setOf(
                "android.permission.MANAGE_EXTERNAL_STORAGE",
                "android.permission.WRITE_EXTERNAL_STORAGE",
                "android.permission.READ_EXTERNAL_STORAGE",
            )
        val manifest = mergedManifest.get().asFile
        // Parsed, not grepped: attribute order and whitespace are the merger's
        // business, and a substring miss here fails silently at Play review.
        val doc =
            DocumentBuilderFactory
                .newInstance()
                .apply { isNamespaceAware = true }
                .newDocumentBuilder()
                .parse(manifest)

        fun elements(tag: String): List<Element> {
            val nodes = doc.getElementsByTagName(tag)
            return (0 until nodes.length).map { nodes.item(it) as Element }
        }

        val found =
            elements("uses-permission")
                .map { it.getAttributeNS(ANDROID_NS, "name") }
                .filter { it in banned }
                .distinct()
        if (found.isNotEmpty()) {
            throw GradleException(
                "The play flavor declares ${found.joinToString()} in ${manifest.name}. Play " +
                    "grants broad storage access only to file managers, backup, and antivirus " +
                    "apps, so this build would be rejected. Move the permission to the sideload " +
                    "flavor, or reach the vault through the SAF folder picker.",
            )
        }

        val legacyStorage =
            elements("application").any {
                it.getAttributeNS(ANDROID_NS, "requestLegacyExternalStorage") == "true"
            }
        if (legacyStorage) {
            throw GradleException(
                "The play flavor sets requestLegacyExternalStorage in ${manifest.name}. That " +
                    "belongs to the sideload flavor only.",
            )
        }
    }

    companion object {
        private const val ANDROID_NS = "http://schemas.android.com/apk/res/android"
    }
}

androidComponents {
    onVariants(selector().withFlavor("distribution" to "play")) { variant ->
        val capitalized = variant.name.replaceFirstChar { it.uppercase() }
        val verify =
            tasks.register<VerifyPlayManifest>("verify${capitalized}Manifest") {
                description = "Fails if the play flavor asks for broad storage access."
                mergedManifest.set(variant.artifacts.get(SingleArtifact.MERGED_MANIFEST))
            }
        tasks
            .matching { it.name == "assemble$capitalized" || it.name == "bundle$capitalized" }
            .configureEach { dependsOn(verify) }
    }
}

// An unsigned bundle looks like a successful build right up until Play rejects
// the upload, so fail here instead of there.
tasks.matching { it.name.startsWith("bundle") && it.name.endsWith("Release") }.configureEach {
    doFirst {
        if (!hasKeystoreProps) {
            throw GradleException(
                "companion/android/keystore.properties is missing, so this bundle would be " +
                    "unsigned. Copy keystore.properties.example, point it at your upload " +
                    "keystore, and keep it out of git.",
            )
        }
    }
}
