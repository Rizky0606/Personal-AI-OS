# kotlinx.serialization: serializer dibangkitkan compiler; pertahankan yang dicari lewat refleksi.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class app.aios.android.data.api.** {
    *** Companion;
}
-keepclasseswithmembers class app.aios.android.data.api.** {
    kotlinx.serialization.KSerializer serializer(...);
}
# Retrofit memeriksa generik antarmuka API lewat refleksi.
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
