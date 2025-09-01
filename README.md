# Wayback Title Extractor

Un outil moderne pour extraire les titres et métadonnées des sites web via l'API CDX de Wayback Machine, avec interface web intuitive pour traitement en masse.

## 🚀 Fonctionnalités

- **Interface Web Moderne** : Interface utilisateur responsive avec design élégant
- **Traitement en Masse** : Analysez plusieurs domaines simultanément
- **Extraction Complète** : Titre, meta description, canonical, robots, Open Graph, nombre de H1
- **Export Multiple** : JSON et CSV
- **Progression en Temps Réel** : Suivi visuel du traitement
- **Gestion d'Erreurs** : Retry automatique et gestion robuste des erreurs
- **Mode CLI** : Script en ligne de commande pour usage avancé

## 📦 Installation

```bash
git clone https://github.com/lkmeldv/wayback-title.git
cd wayback-title
npm install
```

## 🌐 Interface Web

### Démarrage du serveur
```bash
npm run server
# ou
npm run dev
```

Ouvrez http://localhost:3000 dans votre navigateur.

### Utilisation
1. Saisissez vos domaines (un par ligne) dans la zone de texte
2. Configurez le nombre de captures à récupérer (1-20)
3. Optionnel : Activez "Captures uniques" pour déduplication
4. Cliquez sur "Lancer l'extraction"
5. Suivez la progression en temps réel
6. Exportez les résultats en JSON ou CSV

## 💻 Mode CLI

### Utilisation basique
```bash
# 5 dernières captures (par défaut)
node wayback-last.mjs example.com

# Spécifier le nombre de captures
node wayback-last.mjs example.com --n 10

# Mode unique (déduplication par digest)
node wayback-last.mjs example.com --n 5 --unique
```

### Scripts prédéfinis
```bash
npm start                 # example avec linkuma.com
npm run last5            # 5 dernières captures
npm run last5-unique     # 5 dernières captures uniques
```

## 📊 Format des Données

### Données extraites par capture
- **timestamp** : Date de capture (YYYYMMDDHHMMSS)
- **title** : Titre de la page (`<title>`)
- **description** : Meta description
- **canonical** : URL canonique
- **robots** : Directives meta robots
- **og_title** : Titre Open Graph
- **og_description** : Description Open Graph
- **h1_count** : Nombre de balises H1
- **status** : Code de statut HTTP
- **length** : Taille du contenu
- **digest** : Hash du contenu

### Exemple de sortie JSON
```json
{
  "domain": "example.com",
  "snapshots": [
    {
      "timestamp": "20250901000034",
      "title": "Example Domain",
      "description": "This domain is for use in illustrative examples",
      "canonical": "https://example.com/",
      "status": "200",
      "h1_count": 1,
      "length": 1345
    }
  ]
}
```

## ⚡ Caractéristiques Techniques

- **Rate Limiting** : Délai de 150ms entre les requêtes Wayback
- **Retry Logic** : Retry automatique sur erreurs 429/5xx
- **Mode id_** : Récupération du HTML brut non-réécrit
- **Streaming** : Réponses en streaming pour l'interface web
- **Responsive** : Interface adaptée mobile et desktop

## 🛠️ Technologies

- **Backend** : Node.js, Express.js
- **Scraping** : Cheerio, node-fetch
- **Frontend** : Tailwind CSS, Alpine.js
- **API** : Wayback Machine CDX API

## 📁 Structure du Projet

```
wayback-title/
├── public/
│   ├── index.html          # Interface web principale
│   └── js/
│       └── app.js         # Logique frontend Alpine.js
├── out/                   # Fichiers de sortie (ignorés)
├── wayback-last.mjs       # Script CLI principal
├── server.js              # Serveur Express
├── package.json
└── README.md
```

## 🔧 Configuration

### Variables d'environnement
- `PORT` : Port du serveur web (défaut: 3000)

### Paramètres API
- Limite de captures : 1-20
- Timeout par requête : 120 secondes
- User-Agent : `wayback-cdx-extractor/1.0`

## 🚨 Limitations

- API Wayback Machine peut être lente sur certains domaines
- Certaines captures peuvent être indisponibles
- Rate limiting strict pour respecter les serveurs Wayback

## 👤 Auteur

**El Gnani Mohamed**

## 📄 Licence

MIT

---

## 📝 Changelog

### v1.2.0 - 2025-01-09
#### 🚀 Nouvelles fonctionnalités majeures
- **Interface deux colonnes** : Classification automatique Sites Propres vs Sites Spam
- **Détection spam avancée** : 7 catégories (Casino/Jeux, Contenu adulte, Pharma/Santé, Finance suspect, Contrefaçon, Piratage, Spam générique)
- **Import CSV** : Upload de fichiers pour traitement en masse
- **API Perplexity optionnelle** : Analyse IA pour catégorisation automatique
- **Format cartes** : Affichage moderne avec badges colorés et liens directs

#### 🔧 Améliorations techniques
- **Détection locale intelligente** : Plus de 80 mots-clés spam + patterns légitimes
- **Matching précis** : Évite les faux positifs (ex: foot.fr)
- **Interface conditionnelle** : Fonctionne avec ou sans API key
- **Stats temps réel** : Compteurs Sites Propres/Spam
- **Gestion d'erreurs robuste** : Classification même en cas d'échec IA

#### 🎨 Interface utilisateur
- Design deux colonnes responsive
- Onglets saisie manuelle/CSV
- Configuration API masquable
- Badges colorés par catégorie spam
- Liens cliquables vers captures Wayback

### v1.1.0 - 2025-01-09
#### ✨ Ajouts
- Interface web moderne avec design responsive
- Traitement en masse de domaines
- Progression en temps réel avec barre de progression
- Export JSON et CSV depuis l'interface
- Serveur Express avec API streaming
- Support Alpine.js et Tailwind CSS
- Gestion d'erreurs améliorée avec affichage utilisateur
- Liens cliquables vers captures Wayback

#### 🔧 Modifications
- Mise à jour package.json avec nouvelles dépendances
- Ajout des scripts `server` et `dev`
- Version bumped à 1.1.0

#### 📦 Dépendances
- Ajout d'Express.js pour le serveur web
- Conservation de cheerio et node-fetch

### v1.0.0 - 2025-01-09
#### 🎉 Version initiale
- Script CLI pour extraction de titres Wayback
- Support API CDX avec filtres HTML/200
- Extraction complète : title, meta, canonical, OG, H1
- Mode unique avec déduplication par digest
- Sortie console.table + fichiers JSON/CSV
- Retry logic et rate limiting
- Support flags `--n` et `--unique`