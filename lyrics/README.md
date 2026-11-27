# Paroles calées sur la voix

Un fichier par titre (`<id du titre>.json`), lu par l'appli avant les paroles de la base :
`{ v, src, coverage, lines: [{ text, t, e, w: [[mot, début, fin], …], ok }] }` (temps en secondes).

Fabrication : transcription mot à mot de la chanson (ElevenLabs Scribe, via Creative Claw), puis
`tools/align_lyrics.py paroles.txt transcription.json sortie.json` : alignement global (Needleman-Wunsch)
des paroles écrites sur les mots entendus, mots approchants tolérés, mots non reconnus interpolés.
`coverage` = part des mots des paroles retrouvés dans la voix (médiane 96 % sur les 54 premiers titres).
