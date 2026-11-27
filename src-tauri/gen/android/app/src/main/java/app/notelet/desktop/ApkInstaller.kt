package app.notelet.desktop

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

object ApkInstaller {
  @JvmStatic
  fun install(context: Context, apkPath: String): String {
    val file = File(apkPath)
    if (!file.exists() || !file.isFile) {
      throw IllegalArgumentException("ダウンロードした APK ファイルが見つかりません: $apkPath")
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        !context.packageManager.canRequestPackageInstalls()
    ) {
      val settingsIntent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${context.packageName}")
      ).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(settingsIntent)
      return "「この提供元のアプリを許可」を有効にしてから、もう一度アップデートを押してください。"
    }

    val contentUri = FileProvider.getUriForFile(
      context,
      "${context.packageName}.fileprovider",
      file
    )

    val installIntent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(contentUri, "application/vnd.android.package-archive")
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(installIntent)
    return "APK のインストール画面を開きました。画面の指示に従って更新を完了してください。"
  }
}
