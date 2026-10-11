package com.aveon.player;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Шифрование данных приложения ключом из Android Keystore (как DPAPI в Windows-версии):
 * настройки с токенами, альбомы, статистика. Ключ не покидает устройство.
 */
final class Vault {
    private static final String ALIAS = "aveon-data";
    private static final String PREFIX = "AV1:";

    private Vault() {}

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(
            new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return gen.generateKey();
    }

    static String seal(String text) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = c.getIV();
        byte[] enc = c.doFinal(text.getBytes(StandardCharsets.UTF_8));
        byte[] all = new byte[iv.length + enc.length];
        System.arraycopy(iv, 0, all, 0, iv.length);
        System.arraycopy(enc, 0, all, iv.length, enc.length);
        return PREFIX + Base64.encodeToString(all, Base64.NO_WRAP);
    }

    static String open(String stored) throws Exception {
        if (!stored.startsWith(PREFIX)) return stored;
        byte[] all = Base64.decode(stored.substring(PREFIX.length()), Base64.NO_WRAP);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, all, 0, 12));
        return new String(c.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
    }
}
