<?php
// Zkopíruj jako config.php a vyplň. Hodnoty z proměnných prostředí mají přednost.
return [
    // Heslo do administrace (dílny)
    'ADMIN_PASSWORD' => 'zmen-me',

    // Dlouhý náhodný řetězec pro podpisy. Když zůstane prázdný, odvodí se z ADMIN_PASSWORD.
    'APP_SECRET' => '',

    // Kam ukládat data. Nejbezpečnější je složka MIMO veřejný webroot, např. __DIR__ . '/../darky-data'
    'DATA_DIR' => __DIR__ . '/data',

    // Max. velikost PDF v MB (musí ji povolit i post_max_size / upload_max_filesize v PHP)
    'MAX_UPLOAD_MB' => 15,
];
