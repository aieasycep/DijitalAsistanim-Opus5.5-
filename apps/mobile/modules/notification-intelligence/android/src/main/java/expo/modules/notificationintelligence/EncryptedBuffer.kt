package expo.modules.notificationintelligence

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The small on-device signal buffer (API-ANI-01 "bounded 24 h buffer, encrypted on device"). It
 * holds structured signals only — never notification text — AES-256-GCM encrypted with a key
 * that lives in the Android Keystore, in `noBackupFilesDir` (never in a backup). Entries expire
 * after 24 h; uploaded entries stay only for the on-device "Son sinyaller" list until then.
 * `clear()` runs from "Tümünü sil" and from sign-out (`LOGOUT_HOOKS.niBuffer`).
 */
class EncryptedBuffer(context: Context) {
  private val file = File(context.noBackupFilesDir, FILE_NAME)

  data class Entry(val signal: Map<String, Any?>, val storedAt: Long, val uploaded: Boolean) {
    val hash: String get() = signal["signal_hash"] as String
  }

  fun add(signal: Signal, now: Long = System.currentTimeMillis()): Boolean = synchronized(LOCK) {
    val entries = read(now)
    if (entries.any { it.hash == signal.signalHash }) return false
    val next = (entries + Entry(signal.toMap(), now, uploaded = false)).takeLast(MAX_ENTRIES)
    write(next)
    true
  }

  /** Not yet uploaded, oldest first. */
  fun pending(limit: Int, now: Long = System.currentTimeMillis()): List<Entry> = synchronized(LOCK) {
    read(now).filter { !it.uploaded }.take(limit)
  }

  /** The last 24 h, newest first. */
  fun recent(limit: Int, now: Long = System.currentTimeMillis()): List<Entry> = synchronized(LOCK) {
    read(now).sortedByDescending { it.storedAt }.take(limit)
  }

  fun markUploaded(hashes: Collection<String>, now: Long = System.currentTimeMillis()) = synchronized(LOCK) {
    val set = hashes.toSet()
    write(read(now).map { if (it.hash in set) it.copy(uploaded = true) else it })
  }

  fun remove(hash: String, now: Long = System.currentTimeMillis()) = synchronized(LOCK) {
    write(read(now).filterNot { it.hash == hash })
  }

  fun clear() = synchronized(LOCK) {
    file.delete()
  }

  private fun read(now: Long): List<Entry> {
    if (!file.exists()) return emptyList()
    return try {
      val bytes = file.readBytes()
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, IV_BYTES)))
      val json = JSONArray(String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES), Charsets.UTF_8))
      (0 until json.length()).map { i ->
        val row = json.getJSONObject(i)
        Entry(toMap(row.getJSONObject("signal")), row.getLong("stored_at"), row.getBoolean("uploaded"))
      }.filter { now - it.storedAt < TTL_MS }
    } catch (_: Exception) {
      // A lost Keystore key or a corrupt file: start over (the buffer is best effort by design).
      file.delete()
      emptyList()
    }
  }

  private fun write(entries: List<Entry>) {
    if (entries.isEmpty()) {
      file.delete()
      return
    }
    val json = JSONArray()
    for (entry in entries) {
      json.put(
        JSONObject()
          .put("signal", JSONObject(entry.signal))
          .put("stored_at", entry.storedAt)
          .put("uploaded", entry.uploaded),
      )
    }
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val sealed = cipher.doFinal(json.toString().toByteArray(Charsets.UTF_8))
    val tmp = File(file.parentFile, "$FILE_NAME.tmp")
    tmp.writeBytes(cipher.iv + sealed)
    if (!tmp.renameTo(file)) {
      file.delete()
      tmp.renameTo(file)
    }
  }

  private fun toMap(json: JSONObject): Map<String, Any?> =
    json.keys().asSequence().associateWith { key ->
      when (val value = json.get(key)) {
        is JSONObject -> toMap(value)
        JSONObject.NULL -> null
        else -> value
      }
    }

  private fun key(): SecretKey {
    val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }

  companion object {
    private val LOCK = Any()
    private const val FILE_NAME = "da-ni-buffer.bin"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "da.ni.buffer.v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val IV_BYTES = 12
    private const val MAX_ENTRIES = 500
    const val TTL_MS = 24L * 60 * 60 * 1000
  }
}
