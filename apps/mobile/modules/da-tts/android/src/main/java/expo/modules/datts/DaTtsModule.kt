package expo.modules.datts

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import java.io.File
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class SynthesisOptions : Record {
    /** `Voice.name` chosen by the JS voice selection; null = the language default. */
    @Field
    val voice: String? = null

    @Field
    val language: String = "tr-TR"

    /** `file://…/{chapter}-{part}.wav` in the cache directory. */
    @Field
    val uri: String = ""
}

class EngineUnavailableException : CodedException("The text-to-speech engine is not available.")

class SynthesisFailedException(reason: String) : CodedException("Synthesis failed: $reason")

/**
 * `DaTts` (T-8.27): synthesizes one text to one WAV file with `TextToSpeech.synthesizeToFile`, so
 * the briefing player can seek and change speed on real files. One engine per module; calls are
 * serialised because voice and language are engine-wide settings.
 */
class DaTtsModule : Module() {
    private var engine: TextToSpeech? = null
    private var ready: CompletableDeferred<TextToSpeech>? = null
    private val pending = ConcurrentHashMap<String, CompletableDeferred<Unit>>()
    private val mutex = Mutex()

    private val context: Context
        get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

    private val listener = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) = Unit

        override fun onDone(utteranceId: String?) {
            utteranceId?.let { pending.remove(it)?.complete(Unit) }
        }

        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) {
            fail(utteranceId, -1)
        }

        override fun onError(utteranceId: String?, errorCode: Int) {
            fail(utteranceId, errorCode)
        }
    }

    private fun fail(utteranceId: String?, code: Int) {
        utteranceId?.let { pending.remove(it)?.completeExceptionally(SynthesisFailedException("engine error $code")) }
    }

    override fun definition() = ModuleDefinition {
        Name("DaTts")

        Constant("maxInputLength") {
            TextToSpeech.getMaxSpeechInputLength()
        }

        AsyncFunction("getVoices") Coroutine { ->
            val tts = engine()
            (tts.voices ?: emptySet<Voice>()).map { voice ->
                mapOf(
                    "identifier" to voice.name,
                    "name" to voice.name,
                    "language" to voice.locale.toLanguageTag(),
                    "quality" to quality(voice),
                    "networkRequired" to voice.isNetworkConnectionRequired,
                )
            }
        }

        AsyncFunction("synthesizeToFile") Coroutine { text: String, options: SynthesisOptions ->
            mutex.withLock { synthesize(text, options) }
        }

        OnDestroy {
            engine?.shutdown()
            engine = null
            ready = null
        }
    }

    private suspend fun engine(): TextToSpeech {
        val deferred = synchronized(this) {
            ready ?: CompletableDeferred<TextToSpeech>().also { created ->
                ready = created
                var tts: TextToSpeech? = null
                tts = TextToSpeech(context) { status ->
                    val instance = tts
                    if (status == TextToSpeech.SUCCESS && instance != null) {
                        instance.setOnUtteranceProgressListener(listener)
                        created.complete(instance)
                    } else {
                        synchronized(this) { ready = null }
                        created.completeExceptionally(EngineUnavailableException())
                    }
                }
                engine = tts
            }
        }
        return withTimeout(10_000) { deferred.await() }
    }

    private suspend fun synthesize(text: String, options: SynthesisOptions): Map<String, Any> {
        val tts = engine()
        val path = Uri.parse(options.uri).path ?: throw SynthesisFailedException("invalid uri")
        val file = File(path)
        file.parentFile?.mkdirs()
        if (file.exists()) file.delete()
        val voice = options.voice?.let { name -> tts.voices?.firstOrNull { it.name == name } }
        if (voice != null) {
            tts.setVoice(voice)
        } else {
            // LANG_MISSING_DATA / LANG_NOT_SUPPORTED keep the engine default (graceful fallback).
            tts.setLanguage(Locale.forLanguageTag(options.language))
        }
        val id = UUID.randomUUID().toString()
        val done = CompletableDeferred<Unit>()
        pending[id] = done
        try {
            if (tts.synthesizeToFile(text, Bundle(), file, id) != TextToSpeech.SUCCESS) {
                throw SynthesisFailedException("not queued")
            }
            withTimeout(120_000) { done.await() }
        } catch (error: Exception) {
            file.delete()
            throw error
        } finally {
            pending.remove(id)
        }
        return mapOf("uri" to Uri.fromFile(file).toString(), "durationMs" to durationMs(file))
    }

    private fun durationMs(file: File): Double {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(file.path)
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0
        } catch (error: RuntimeException) {
            0.0
        } finally {
            retriever.release()
        }
    }

    private fun quality(voice: Voice): String = when {
        voice.quality >= Voice.QUALITY_VERY_HIGH -> "premium"
        voice.quality >= Voice.QUALITY_HIGH -> "enhanced"
        else -> "default"
    }
}
