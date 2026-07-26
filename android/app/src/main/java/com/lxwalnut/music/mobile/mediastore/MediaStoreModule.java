package com.lxwalnut.music.mobile.mediastore;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import androidx.core.content.ContextCompat;

/**
 * 使用 MediaStore 查询设备上所有音频文件的原生模块
 * 可以扫描整个内部存储，不受 SAF 限制
 */
public class MediaStoreModule extends ReactContextBaseJavaModule {

  private static final String[] AUDIO_PROJECTION = {
    MediaStore.Audio.Media._ID,
    MediaStore.Audio.Media.DATA,
    MediaStore.Audio.Media.DISPLAY_NAME,
    MediaStore.Audio.Media.TITLE,
    MediaStore.Audio.Media.ARTIST,
    MediaStore.Audio.Media.ALBUM,
    MediaStore.Audio.Media.DURATION,
    MediaStore.Audio.Media.MIME_TYPE,
    MediaStore.Audio.Media.SIZE,
    MediaStore.Audio.Media.DATE_ADDED
  };

  MediaStoreModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "MediaStoreModule";
  }

  /**
   * 检查是否有读取音频的权限
   */
  private boolean hasAudioPermission() {
    Context context = getReactApplicationContext();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      // Android 13+ 需要 READ_MEDIA_AUDIO
      return ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_AUDIO)
          == PackageManager.PERMISSION_GRANTED;
    } else {
      // Android 12 及以下需要 READ_EXTERNAL_STORAGE
      return ContextCompat.checkSelfPermission(context, Manifest.permission.READ_EXTERNAL_STORAGE)
          == PackageManager.PERMISSION_GRANTED;
    }
  }

  /**
   * 查询设备上所有音频文件
   */
  @ReactMethod
  public void getAllAudioFiles(Promise promise) {
    try {
      if (!hasAudioPermission()) {
        promise.reject("PERMISSION_DENIED", "没有读取音频文件的权限");
        return;
      }

      ContentResolver resolver = getReactApplicationContext().getContentResolver();
      Uri collection;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL);
      } else {
        collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
      }

      // 只查询音频文件（IS_MUSIC = 1），排除铃声、通知音等
      String selection = MediaStore.Audio.Media.IS_MUSIC + " != 0";
      String sortOrder = MediaStore.Audio.Media.DATE_ADDED + " DESC";

      Cursor cursor = resolver.query(
          collection,
          AUDIO_PROJECTION,
          selection,
          null,
          sortOrder
      );

      WritableArray audioList = Arguments.createArray();
      if (cursor != null) {
        try {
          int idIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
          int dataIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA);
          int nameIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME);
          int titleIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
          int artistIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
          int albumIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
          int durationIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
          int mimeIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE);
          int sizeIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE);
          int dateIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED);

          while (cursor.moveToNext()) {
            WritableMap item = Arguments.createMap();
            long id = cursor.getLong(idIdx);
            String data = cursor.getString(dataIdx);
            String displayName = cursor.getString(nameIdx);
            String title = cursor.getString(titleIdx);
            String artist = cursor.getString(artistIdx);
            String album = cursor.getString(albumIdx);
            long duration = cursor.getLong(durationIdx);
            String mimeType = cursor.getString(mimeIdx);
            long size = cursor.getLong(sizeIdx);
            long dateAdded = cursor.getLong(dateIdx);

            // 构建 contentUri，用于无法直接访问文件的场景
            Uri contentUri = ContentUris.withAppendedId(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);

            item.putString("id", String.valueOf(id));
            item.putString("filePath", data != null ? data : "");
            item.putString("contentUri", contentUri.toString());
            item.putString("fileName", displayName != null ? displayName : "");
            item.putString("title", title != null ? title : "");
            item.putString("artist", artist != null && !artist.equals("<unknown>") ? artist : "");
            item.putString("album", album != null && !album.equals("<unknown>") ? album : "");
            item.putDouble("duration", duration / 1000.0); // 转为秒
            item.putString("mimeType", mimeType != null ? mimeType : "");
            item.putDouble("size", size);
            item.putDouble("dateAdded", dateAdded);

            audioList.pushMap(item);
          }
        } finally {
          cursor.close();
        }
      }

      promise.resolve(audioList);
    } catch (Exception e) {
      promise.reject("QUERY_ERROR", "查询音频文件失败: " + e.getMessage(), e);
    }
  }

  /**
   * 检查是否有读取音频的权限
   */
  @ReactMethod
  public void checkAudioPermission(Promise promise) {
    promise.resolve(hasAudioPermission());
  }
}
