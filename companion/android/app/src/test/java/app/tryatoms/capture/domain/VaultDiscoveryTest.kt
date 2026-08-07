package app.tryatoms.capture.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class VaultDiscoveryTest {
    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun primaryRelativePathStripsEmulatedRoot() {
        assertEquals(
            "Documents/Remote Vault",
            VaultPaths.primaryRelativePath("/storage/emulated/0/Documents/Remote Vault"),
        )
        assertEquals(
            "Documents/Remote Vault",
            VaultPaths.primaryRelativePath("/sdcard/Documents/Remote Vault"),
        )
    }

    @Test
    fun primaryRelativePathRejectsUnknownRoots() {
        assertNull(VaultPaths.primaryRelativePath("/data/data/app/files/vault"))
    }

    @Test
    fun treeUriUsesPrimaryDocumentId() {
        val uri =
            VaultPaths.filePathToTreeUriString("/storage/emulated/0/Documents/Remote Vault")
        assertNotNull(uri)
        assertTrue(uri!!.startsWith("content://com.android.externalstorage.documents/tree/"))
        assertTrue(uri.contains("primary"))
        assertTrue(uri.contains("Documents"))
        assertTrue(uri.contains("Remote"))
    }

    @Test
    fun scanFindsObsidianFolderAndScoresAtoms() {
        val docs = tmp.newFolder("Documents")
        val plain = File(docs, "PlainNotes").also {
            it.mkdirs()
            File(it, ".obsidian").mkdirs()
        }
        val atoms = File(docs, "Remote Vault").also {
            it.mkdirs()
            File(it, ".obsidian").mkdirs()
            File(it, "Atoms System").mkdirs()
            File(it, ".obsidian/plugins/atoms").mkdirs()
        }
        File(docs, "NotAVault").mkdirs()

        val found = VaultScanner.scan(listOf(docs))
        assertEquals(2, found.size)
        assertEquals(atoms.canonicalPath, found.first().absolutePath)
        assertTrue(found.first().score > found.last().score)
        assertEquals(plain.canonicalPath, found.last().absolutePath)
    }

    @Test
    fun scoreBoostsAtomsMarkers() {
        val vault = tmp.newFolder("v")
        File(vault, ".obsidian").mkdirs()
        assertEquals(1, VaultScanner.score(vault))
        File(vault, "Atoms System").mkdirs()
        assertTrue(VaultScanner.score(vault) >= 11)
    }
}
