/**
 * strings.ts — everything MusicLoop says, in the languages it says it in.
 *
 * Same contract as Pixel FX and Lab Watch: the host broadcasts its language,
 * a key missing from a locale falls back to English key by key, an unknown
 * placeholder stays visible. en / fr / es are written; de / pt / ru / zh read
 * English until the night translation fills them.
 */

/** The languages the host can ask for. */
export const LANGS = ['en', 'fr', 'es', 'de', 'pt', 'ru', 'zh'] as const;
/** One of them. */
export type Lang = (typeof LANGS)[number];

const en = {
  'app.title': 'MusicLoop',

  'open.button': 'Open a sound',
  'open.drop': 'Open a sound, or drop one here',
  'open.filter': 'Sounds and films',
  'open.loading': 'Reading {name}',
  'open.captured': 'Captured from the computer',

  'error.NOT_DECODED': 'This file is not a sound this app can read.',
  'error.TOO_LONG': 'This sound is longer than 10 minutes.',
  'error.EMPTY_SOUND': 'This file holds no sound.',
  'error.DECODE_TIMEOUT': 'No answer after 60 seconds while reading the file.',
  'error.NO_WEB_AUDIO': 'This browser has no Web Audio.',
  'error.FETCH_FAILED': 'The file could not be read.',
  'error.PATH_OUTSIDE_HOME': 'This file is outside the personal folder.',
  'error.NOT_A_FILM_OR_SOUND': 'This file is neither a sound nor a film.',
  'error.NOT_FOUND': 'This file is no longer there.',
  'error.permission': 'Mnemosyne OS has not given this app access to files.',
  'error.timeout': 'No answer from Mnemosyne OS.',
  'error.STRETCH_FAILED': 'The speed change with the pitch kept did not run. The loop plays as it was.',
  'error.STRETCH_TIMEOUT': 'The speed change gave no answer after 45 seconds. The loop plays as it was.',
  'error.RENDER_TIMEOUT': 'The file was not written after 2 minutes.',
  'error.AUDIO_ASLEEP': 'The sound output did not start.',
  'error.other': 'Not done: {code}',
  'error.retry': 'Try again',

  'wave.label': 'Waveform of {name}',
  'wave.overview': 'The whole sound',
  'wave.start': 'Start of the loop',
  'wave.end': 'End of the loop',
  'wave.length': 'Length',
  'wave.zoomLoop': 'Show the loop',
  'wave.zoomAll': 'Show the whole sound',
  'wave.zoomIn': 'Zoom in',
  'wave.zoomOut': 'Zoom out',

  'play.play': 'Play the loop',
  'play.stop': 'Stop',
  'play.preparing': 'Preparing the loop',

  'tempo.label': 'Tempo',
  'tempo.bpm': 'BPM',
  'tempo.none': 'No tempo found',
  'tempo.unsure': 'Tempo to check',
  'tempo.half': 'Half the tempo',
  'tempo.double': 'Twice the tempo',
  'tempo.snap': 'Snap the handles to the beats',
  'tempo.beats': 'Beats',
  'tempo.beatsOf': 'A loop of {n} beats',

  'card.shape': 'Loop',
  'card.eq': 'Equaliser',
  'card.fx': 'Effects',
  'card.time': 'Speed and pitch',
  'card.export': 'Export',
  'card.kept': 'Kept loops',

  'set.fadeMs': 'Seam',
  'set.reverse': 'Backwards',
  'set.low': 'Bass',
  'set.mid': 'Middle',
  'set.high': 'Treble',
  'set.gainDb': 'Level',
  'set.filter': 'Filter',
  'set.drive': 'Saturation',
  'set.echoMix': 'Echo',
  'set.echoMs': 'Echo time',
  'set.echoFeedback': 'Echo repeats',
  'set.reverbMix': 'Reverb',
  'set.reverbSeconds': 'Reverb length',
  'set.speed': 'Speed',
  'set.semitones': 'Pitch',
  'set.keepPitch': 'Keep the pitch',
  'set.targetBpm': 'Target tempo',
  'set.reset': 'Back to {value}',
  'set.resetAll': 'Reset every setting',

  'unit.db': '{n} dB',
  'unit.ms': '{n} ms',
  'unit.s': '{n} s',
  'unit.percent': '{n} %',
  'unit.times': '× {n}',
  'unit.semitones': '{n} st',
  'unit.mb': '{n} MB',
  'unit.off': 'Off',
  'unit.lowpass': 'Low-pass {n} Hz',
  'unit.highpass': 'High-pass {n} Hz',

  'export.length': 'Length of the file',
  'export.seconds': '{n} s',
  'export.lap': '1 lap',
  'export.custom': 'Other length, in seconds',
  'export.save': 'Save the WAV',
  'export.rendering': 'Writing the file',
  'export.saved': 'Saved: {name} · {seconds} s · {size}',
  'export.show': 'Show in its folder',
  'export.downloaded': 'Downloaded: {name}',
  'export.rights': 'A sound captured from someone else\'s music can be taken down or demonetised by a network.',
  'export.error.EXISTS': 'Not saved: 20 files already carry this name.',
  'export.error.EXTENSION_NOT_ALLOWED': 'Not saved: this version of Mnemosyne OS does not let an app write a WAV.',
  'export.error.TOO_LARGE': 'Not saved: the file passes 50 MB.',
  'export.error.NO_VAULT_ROOT': 'Not saved: no app folder yet. Choose a memory folder in Mnemosyne OS first.',

  'kept.keep': 'Keep this loop',
  'kept.name': 'Name of the loop',
  'kept.open': 'Open {name}',
  'kept.remove': 'Remove {name}',
  'kept.none': 'No kept loop',
  'kept.loading': 'Reading the kept loops',
  'kept.session': 'To keep a loop, open its file with the button.',
  'kept.error': 'Kept loops not saved.',
  'kept.loadError': 'Kept loops not read.',

  'card.captures': 'Captured sounds',
  'captures.open': 'Open {name}',
  'captures.khz': '{n} kHz',
  'captures.error': 'Captured sounds not read.',
  'captures.tooLong': '{name}: longer than 10 minutes',

  'credits.open': 'Credits',
  'credits.close': 'Close',
  'credits.stretch': 'The speed change with the pitch kept is Signalsmith Stretch, by Geraint Luff, MIT License.',
} as const;

/** A string of the screen, by its key. */
export type Key = keyof typeof en;

const fr: Record<Key, string> = {
  'app.title': 'MusicLoop',

  'open.button': 'Ouvrir un son',
  'open.drop': 'Ouvrir un son, ou en déposer un ici',
  'open.filter': 'Sons et films',
  'open.loading': 'Lecture de {name}',
  'open.captured': 'Capté sur l\'ordinateur',

  'error.NOT_DECODED': 'Ce fichier n\'est pas un son que cette app sait lire.',
  'error.TOO_LONG': 'Ce son dure plus de 10 minutes.',
  'error.EMPTY_SOUND': 'Ce fichier ne contient aucun son.',
  'error.DECODE_TIMEOUT': 'Pas de réponse après 60 secondes pendant la lecture du fichier.',
  'error.NO_WEB_AUDIO': 'Ce navigateur n\'a pas Web Audio.',
  'error.FETCH_FAILED': 'Le fichier n\'a pas pu être lu.',
  'error.PATH_OUTSIDE_HOME': 'Ce fichier est hors du dossier personnel.',
  'error.NOT_A_FILM_OR_SOUND': 'Ce fichier n\'est ni un son ni un film.',
  'error.NOT_FOUND': 'Ce fichier n\'est plus là.',
  'error.permission': 'Mnemosyne OS n\'a pas donné à cette app l\'autorisation de lire des fichiers.',
  'error.timeout': 'Pas de réponse de Mnemosyne OS.',
  'error.STRETCH_FAILED': 'Le changement de vitesse à hauteur gardée n\'a pas tourné. La boucle joue comme avant.',
  'error.STRETCH_TIMEOUT': 'Le changement de vitesse n\'a pas répondu après 45 secondes. La boucle joue comme avant.',
  'error.RENDER_TIMEOUT': 'Le fichier n\'était pas écrit après 2 minutes.',
  'error.AUDIO_ASLEEP': 'La sortie son n\'a pas démarré.',
  'error.other': 'Pas fait : {code}',
  'error.retry': 'Réessayer',

  'wave.label': 'Forme d\'onde de {name}',
  'wave.overview': 'Le son entier',
  'wave.start': 'Début de la boucle',
  'wave.end': 'Fin de la boucle',
  'wave.length': 'Durée',
  'wave.zoomLoop': 'Montrer la boucle',
  'wave.zoomAll': 'Montrer le son entier',
  'wave.zoomIn': 'Zoomer',
  'wave.zoomOut': 'Dézoomer',

  'play.play': 'Jouer la boucle',
  'play.stop': 'Arrêter',
  'play.preparing': 'Préparation de la boucle',

  'tempo.label': 'Tempo',
  'tempo.bpm': 'BPM',
  'tempo.none': 'Aucun tempo trouvé',
  'tempo.unsure': 'Tempo à vérifier',
  'tempo.half': 'Tempo divisé par deux',
  'tempo.double': 'Tempo doublé',
  'tempo.snap': 'Caler les poignées sur les temps',
  'tempo.beats': 'Temps',
  'tempo.beatsOf': 'Une boucle de {n} temps',

  'card.shape': 'Boucle',
  'card.eq': 'Égaliseur',
  'card.fx': 'Effets',
  'card.time': 'Vitesse et hauteur',
  'card.export': 'Export',
  'card.kept': 'Boucles gardées',

  'set.fadeMs': 'Jointure',
  'set.reverse': 'À l\'envers',
  'set.low': 'Basses',
  'set.mid': 'Médiums',
  'set.high': 'Aigus',
  'set.gainDb': 'Niveau',
  'set.filter': 'Filtre',
  'set.drive': 'Saturation',
  'set.echoMix': 'Écho',
  'set.echoMs': 'Délai de l\'écho',
  'set.echoFeedback': 'Répétitions de l\'écho',
  'set.reverbMix': 'Réverbération',
  'set.reverbSeconds': 'Durée de la réverbération',
  'set.speed': 'Vitesse',
  'set.semitones': 'Hauteur',
  'set.keepPitch': 'Garder la hauteur',
  'set.targetBpm': 'Tempo visé',
  'set.reset': 'Revenir à {value}',
  'set.resetAll': 'Remettre tous les réglages à zéro',

  'unit.db': '{n} dB',
  'unit.ms': '{n} ms',
  'unit.s': '{n} s',
  'unit.percent': '{n} %',
  'unit.times': '× {n}',
  'unit.semitones': '{n} dt',
  'unit.mb': '{n} Mo',
  'unit.off': 'Coupé',
  'unit.lowpass': 'Passe-bas {n} Hz',
  'unit.highpass': 'Passe-haut {n} Hz',

  'export.length': 'Durée du fichier',
  'export.seconds': '{n} s',
  'export.lap': '1 tour',
  'export.custom': 'Autre durée, en secondes',
  'export.save': 'Enregistrer le WAV',
  'export.rendering': 'Écriture du fichier',
  'export.saved': 'Enregistré : {name} · {seconds} s · {size}',
  'export.show': 'Montrer dans son dossier',
  'export.downloaded': 'Téléchargé : {name}',
  'export.rights': 'Un son capté dans la musique de quelqu\'un d\'autre peut être retiré ou démonétisé par un réseau.',
  'export.error.EXISTS': 'Pas enregistré : 20 fichiers portent déjà ce nom.',
  'export.error.EXTENSION_NOT_ALLOWED': 'Pas enregistré : cette version de Mnemosyne OS ne laisse pas une app écrire un WAV.',
  'export.error.TOO_LARGE': 'Pas enregistré : le fichier dépasse 50 Mo.',
  'export.error.NO_VAULT_ROOT': 'Pas enregistré : pas encore de dossier d\'app. Choisir d\'abord un dossier de mémoire dans Mnemosyne OS.',

  'kept.keep': 'Garder cette boucle',
  'kept.name': 'Nom de la boucle',
  'kept.open': 'Ouvrir {name}',
  'kept.remove': 'Retirer {name}',
  'kept.none': 'Aucune boucle gardée',
  'kept.loading': 'Lecture des boucles gardées',
  'kept.session': 'Pour garder une boucle, ouvrir son fichier par le bouton.',
  'kept.error': 'Boucles gardées non enregistrées.',
  'kept.loadError': 'Boucles gardées non lues.',

  'card.captures': 'Sons captés',
  'captures.open': 'Ouvrir {name}',
  'captures.khz': '{n} kHz',
  'captures.error': 'Sons captés non lus.',
  'captures.tooLong': '{name} : plus de 10 minutes',

  'credits.open': 'Crédits',
  'credits.close': 'Fermer',
  'credits.stretch': 'Le changement de vitesse à hauteur gardée est Signalsmith Stretch, de Geraint Luff, sous licence MIT.',
};

const es: Record<Key, string> = {
  'app.title': 'MusicLoop',

  'open.button': 'Abrir un sonido',
  'open.drop': 'Abrir un sonido, o soltar uno aquí',
  'open.filter': 'Sonidos y películas',
  'open.loading': 'Leyendo {name}',
  'open.captured': 'Captado en el ordenador',

  'error.NOT_DECODED': 'Este archivo no es un sonido que esta app sepa leer.',
  'error.TOO_LONG': 'Este sonido dura más de 10 minutos.',
  'error.EMPTY_SOUND': 'Este archivo no contiene ningún sonido.',
  'error.DECODE_TIMEOUT': 'Sin respuesta tras 60 segundos durante la lectura del archivo.',
  'error.NO_WEB_AUDIO': 'Este navegador no tiene Web Audio.',
  'error.FETCH_FAILED': 'No se pudo leer el archivo.',
  'error.PATH_OUTSIDE_HOME': 'Este archivo está fuera de la carpeta personal.',
  'error.NOT_A_FILM_OR_SOUND': 'Este archivo no es ni un sonido ni una película.',
  'error.NOT_FOUND': 'Este archivo ya no está.',
  'error.permission': 'Mnemosyne OS no ha dado a esta app permiso para leer archivos.',
  'error.timeout': 'Sin respuesta de Mnemosyne OS.',
  'error.STRETCH_FAILED': 'El cambio de velocidad con el tono conservado no funcionó. El bucle suena como antes.',
  'error.STRETCH_TIMEOUT': 'El cambio de velocidad no respondió tras 45 segundos. El bucle suena como antes.',
  'error.RENDER_TIMEOUT': 'El archivo no estaba escrito tras 2 minutos.',
  'error.AUDIO_ASLEEP': 'La salida de sonido no arrancó.',
  'error.other': 'No hecho: {code}',
  'error.retry': 'Reintentar',

  'wave.label': 'Forma de onda de {name}',
  'wave.overview': 'El sonido entero',
  'wave.start': 'Inicio del bucle',
  'wave.end': 'Fin del bucle',
  'wave.length': 'Duración',
  'wave.zoomLoop': 'Mostrar el bucle',
  'wave.zoomAll': 'Mostrar el sonido entero',
  'wave.zoomIn': 'Acercar',
  'wave.zoomOut': 'Alejar',

  'play.play': 'Reproducir el bucle',
  'play.stop': 'Detener',
  'play.preparing': 'Preparando el bucle',

  'tempo.label': 'Tempo',
  'tempo.bpm': 'BPM',
  'tempo.none': 'Ningún tempo encontrado',
  'tempo.unsure': 'Tempo por comprobar',
  'tempo.half': 'Tempo dividido entre dos',
  'tempo.double': 'Tempo duplicado',
  'tempo.snap': 'Ajustar los tiradores a los tiempos',
  'tempo.beats': 'Tiempos',
  'tempo.beatsOf': 'Un bucle de {n} tiempos',

  'card.shape': 'Bucle',
  'card.eq': 'Ecualizador',
  'card.fx': 'Efectos',
  'card.time': 'Velocidad y tono',
  'card.export': 'Exportar',
  'card.kept': 'Bucles guardados',

  'set.fadeMs': 'Unión',
  'set.reverse': 'Al revés',
  'set.low': 'Graves',
  'set.mid': 'Medios',
  'set.high': 'Agudos',
  'set.gainDb': 'Nivel',
  'set.filter': 'Filtro',
  'set.drive': 'Saturación',
  'set.echoMix': 'Eco',
  'set.echoMs': 'Retardo del eco',
  'set.echoFeedback': 'Repeticiones del eco',
  'set.reverbMix': 'Reverberación',
  'set.reverbSeconds': 'Duración de la reverberación',
  'set.speed': 'Velocidad',
  'set.semitones': 'Tono',
  'set.keepPitch': 'Conservar el tono',
  'set.targetBpm': 'Tempo deseado',
  'set.reset': 'Volver a {value}',
  'set.resetAll': 'Restablecer todos los ajustes',

  'unit.db': '{n} dB',
  'unit.ms': '{n} ms',
  'unit.s': '{n} s',
  'unit.percent': '{n} %',
  'unit.times': '× {n}',
  'unit.semitones': '{n} st',
  'unit.mb': '{n} MB',
  'unit.off': 'Apagado',
  'unit.lowpass': 'Paso bajo {n} Hz',
  'unit.highpass': 'Paso alto {n} Hz',

  'export.length': 'Duración del archivo',
  'export.seconds': '{n} s',
  'export.lap': '1 vuelta',
  'export.custom': 'Otra duración, en segundos',
  'export.save': 'Guardar el WAV',
  'export.rendering': 'Escribiendo el archivo',
  'export.saved': 'Guardado: {name} · {seconds} s · {size}',
  'export.show': 'Mostrar en su carpeta',
  'export.downloaded': 'Descargado: {name}',
  'export.rights': 'Un sonido captado de la música de otra persona puede ser retirado o desmonetizado por una red.',
  'export.error.EXISTS': 'No guardado: 20 archivos ya llevan este nombre.',
  'export.error.EXTENSION_NOT_ALLOWED': 'No guardado: esta versión de Mnemosyne OS no deja que una app escriba un WAV.',
  'export.error.TOO_LARGE': 'No guardado: el archivo supera los 50 MB.',
  'export.error.NO_VAULT_ROOT': 'No guardado: aún no hay carpeta de app. Elegir primero una carpeta de memoria en Mnemosyne OS.',

  'kept.keep': 'Guardar este bucle',
  'kept.name': 'Nombre del bucle',
  'kept.open': 'Abrir {name}',
  'kept.remove': 'Quitar {name}',
  'kept.none': 'Ningún bucle guardado',
  'kept.loading': 'Leyendo los bucles guardados',
  'kept.session': 'Para guardar un bucle, abrir su archivo con el botón.',
  'kept.error': 'Bucles guardados no registrados.',
  'kept.loadError': 'Bucles guardados no leídos.',

  'card.captures': 'Sonidos captados',
  'captures.open': 'Abrir {name}',
  'captures.khz': '{n} kHz',
  'captures.error': 'Sonidos captados no leídos.',
  'captures.tooLong': '{name}: más de 10 minutos',

  'credits.open': 'Créditos',
  'credits.close': 'Cerrar',
  'credits.stretch': 'El cambio de velocidad con el tono conservado es Signalsmith Stretch, de Geraint Luff, con licencia MIT.',
};

/** The locales written by hand. The others read English. */
export const WRITTEN = { en, fr, es } as const;

/** Whether `v` is a language this file knows by name. */
export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);

/** `key` in `lang`, falling back to English key by key; `{name}` placeholders filled, unknown ones left visible. */
export function translate(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  const table = (WRITTEN as Record<string, Record<string, string> | undefined>)[lang];
  const text = table?.[key] ?? en[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** The translate function a component is handed. */
export type T = (key: Key, vars?: Record<string, string | number>) => string;

/** A refusal code from the host or the audio engine, in words; an unknown code stays visible after them. */
export function errorText(t: T, code: string): string {
  const known = `error.${code}` as Key;
  if (known in en) return t(known);
  if (/does not have the .* permission|Unauthorized/i.test(code)) return t('error.permission');
  if (/did not reply|within \d+s|TIMEOUT/i.test(code)) return t('error.timeout');
  return t('error.other', { code });
}

/** Why a file was not saved, in words. */
export function exportRefusal(t: T, code: string): string {
  const known = `export.error.${code}` as Key;
  if (known in en) return t(known);
  return errorText(t, code);
}
