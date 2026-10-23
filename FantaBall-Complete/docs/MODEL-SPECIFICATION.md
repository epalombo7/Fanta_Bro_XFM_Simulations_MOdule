# Target model specification v0.1

P(rating_g)=P(fit_g)*P(eligible_g|fit_g)*P(valid rating_g|fit_g,eligible_g).
Expected rated appearances=sum_g P(rating_g).
Expected points=sum_g P(rating_g)*E[fantasy score_g|rated].
Integrità=100*mean_g P(fit_g). Reliability requires a separately documented rubric and category thresholds. Confidence refers to evidence/model quality, not predicted participation.

Fixture model candidate: log(nonpenalty goal intensity)=player baseline+log(minutes/90)+own attack-opponent defence+venue+role effects. Estimate coefficients; shrink sparse personal effects toward team/league priors. If upstream team-goal forecasts contain opponent/venue effects, allocate them rather than apply effects again. Handle assists/penalties/provider definitions coherently. Keeper concession and clean-sheet outcomes share the same simulated match result.

Monte Carlo: shared worlds; sample uncertain persistent team/player parameters, recovery and hierarchy, then chronological fixtures/fitness/eligibility/selection/minutes/match outcomes. Use sufficient draws to stabilize decision probabilities and price percentiles, starting around 10,000 in development then checking convergence. More draws do not fix bad assumptions. Target and alternatives must be compared within identical worlds.

Price definition: highest feasible cost at which best squad strategy including player remains preferable to best strategy excluding player under configured utility. Evaluate fielded lineups and substitutes, not raw roster points. Convert marginal value to credits consistently in every world. Distinguish random season outcomes, uncertainty in parameters and market acquisition cost. Report P10–P90 model price interval; validate before treating interval coverage as calibrated.

Demo uses 1,000 draws, synthetic strengths, simple independent contributions and positive raw-point VOR normalization across its pool. Its reliability proxy and price screening do not implement the target specification.
