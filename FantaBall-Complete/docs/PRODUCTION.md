# No-user-key architecture and deployment
Users sign in to FantaBall; they never enter AI provider credentials. App calls your HTTPS backend with an app session. Backend authenticates user, checks quota, retrieves authoritative league/ledger/forecasts, invokes correct chat skill using server secret, and returns grounded advice. App endpoint is preconfigured; remove development server settings from customer UI.

Your business pays API charges. Store keys in hosting secret manager; never put them in JavaScript, mobile build, repository or logs. Provider spend/rate limits supplement per-user limits. Add request/message/output caps, account quotas, usage logging, cost alerts and graceful fallback. Don't rerun Monte Carlo for every chat or bidding increment; cache versioned forecasts and recompute budget constraints on ledger changes.

Production components: licensed data ingestion and canonical IDs; versioned forecast library; scoring/formation engine; coherent simulation and optimizer; database with tenant isolation; atomic auction events; authenticated chat read tools; explicit confirmed writes; scheduler/event updates; notifications; billing; HTTPS/security/privacy/deletion; tests/monitoring.

Development server here lacks user auth, quotas, authoritative state and persistent cloud storage. Client context is untrusted and must not authorize production actions. CORS is not authentication. Do not publish this server as-is. Mobile HTTP can be blocked: use HTTPS. A consumer chat subscription is not substituted for provider API infrastructure.

Suggested monetization hypotheses: limited free preview, bounded seasonal auction pass, season subscription with alerts, league plan with private per-team advice. Validate willingness to pay and total data/AI/hosting/support cost before pricing. Do not promise unlimited usage or guaranteed wins.

Data rights review must cover commercial display, storage, redistribution, derivative projections, history/backtesting and images/logos/provider ratings. AI processing does not erase input licenses.
