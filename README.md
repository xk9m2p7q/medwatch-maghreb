# MedWatch Maghreb

**Western Mediterranean Intelligence Monitor**  
A strategic intelligence monitoring system for the Maghreb and Western Mediterranean.

Built by Samuel Herize — IR (Universidad de Navarra) / MA Technology & Global Affairs (IE Madrid)

---

## Deploy to Vercel (15 minutes)

### 1. Push to GitHub
Create a new repository called `medwatch-maghreb` on GitHub and push these files:
```
medwatch-maghreb/
├── index.html
├── vercel.json
└── api/
    └── analyze.js
```

### 2. Connect to Vercel
- Go to [vercel.com](https://vercel.com) and sign in with GitHub
- Click "Add New Project"
- Import your `medwatch-maghreb` repository
- Click "Deploy" — no build settings needed

### 3. Add your API key (optional — enables AI analysis)
- In Vercel dashboard → your project → Settings → Environment Variables
- Add: `ANTHROPIC_API_KEY` = your key from console.anthropic.com
- Redeploy: Deployments → three dots → Redeploy

### 4. Your live URL
`https://medwatch-maghreb.vercel.app`

---

## What works without an API key
- Full intelligence feed (9 seeded items)
- Country / theme / priority filtering
- Bilingual EN/ES toggle
- All tags, metadata, source attribution

## What requires an API key
- Live AI analysis on each card (strategic significance, key actors, 30-day watch, Spain angle)
- Custom text analysis input

---

## Stack
- Frontend: Vanilla HTML/CSS/JS — zero dependencies
- Backend: Vercel serverless function (API proxy)
- AI: Anthropic Claude Sonnet via API
- Hosting: Vercel free tier

---

## Contact
samuel.herize@alumni.unav.es
