<?php
// Zkopíruj jako config.php a vyplň. Hodnoty z proměnných prostředí mají přednost.
return [
    // Tajný klíč aplikace (povinný, aspoň 16 znaků): podepisuje přihlášení do dílen a šifruje jejich odkazy.
    // Vygeneruj třeba: openssl rand -base64 32. Musí být stejný jako v Node verzi, pokud mezi nimi přenášíš data.
    'APP_SECRET' => '',

    // Kdo smí zakládat dílny. Prázdné = kdokoli. Vyplněné = při založení je potřeba zadat tenhle kód.
    'SIGNUP_CODE' => '',

    // Limity na jednu dílnu
    'MAX_GIFTS' => 50,
    'MAX_STORAGE_MB' => 100,

    // Kam ukládat data. Nejbezpečnější je složka MIMO veřejný webroot, např. __DIR__ . '/../darky-data'
    'DATA_DIR' => __DIR__ . '/data',

    // Max. velikost jednoho PDF v MB (musí ji povolit i post_max_size / upload_max_filesize v PHP)
    'MAX_UPLOAD_MB' => 15,

    // ---- E-maily s odkazem do dílny (nepovinné) ----
    // Zapnou se, když jsou vyplněné SMTP_HOST, MAIL_FROM a APP_URL. Údaje najdeš u e-mailové schránky na hostingu.
    'APP_URL' => '',              // veřejná adresa webu bez lomítka na konci, např. https://darky.example.cz
    'MAIL_FROM' => '',            // odesílatel, např. Ježíškova dílna <dilna@example.cz> (adresa z tvé domény)
    'MAIL_REPLY_TO' => '',        // nepovinné: kam půjdou odpovědi
    'SMTP_HOST' => '',            // např. smtp.example.cz
    'SMTP_PORT' => 465,           // 465 = TLS, 587 = STARTTLS
    'SMTP_SECURE' => '',          // prázdné = podle portu; jinak tls | starttls | none
    'SMTP_USER' => '',            // obvykle celá e-mailová adresa
    'SMTP_PASS' => '',
    // 'MAIL_TRANSPORT' => 'mail', // místo SMTP použít PHP funkci mail() (když hosting SMTP nenabízí)
];
