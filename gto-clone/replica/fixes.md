# What users say, and what we do about it

**Sample: 6 verbatim quotes from 2 sources** (one PokerChipForum thread and Hacker News). That is far short of the 100+ this step aims for, so **every theme below is thin.**
- Trustpilot returned 404 for gtowizard.com.
- The Hacker News Algolia API had 5 relevant comments out of 30 hits.
- The web search turned up no real Reddit threads, only SEO filler.

Reading r/poker and r/GTOWizard by hand in your own browser would be the next step if this ever becomes a product. (`reviews.py` wasn't run because Python isn't installed. With 6 rows it would only flag everything as thin anyway.)

## 1. What they hate (thin)
- **Too much for beginners.** 1 quote, 1 source. "I would not recommend it (or really any solvers) for beginners though." ([thread](https://www.pokerchipforum.com/threads/feedback-on-poker-training-websites-gto-wizard-or-pokercoaching-com.141059/))
- **Cost vs. stakes.** 1 quote, 1 source. "…the GTO Wizard or Premium membership would be worth the cost." ([thread](https://www.pokerchipforum.com/threads/feedback-on-poker-training-websites-gto-wizard-or-pokercoaching-com.141059/)) Public pricing is $39–$229/month ([pokerlistings](https://www.pokerlistings.com/poker-tools/trackers/gto-wizard)).

## 2. What is missing (thin)
- **Drill your own custom ranges.** 1 quote, 1 source. "…want to be able to put in custom/arbitrary ranges to test." ([HN](https://news.ycombinator.com/item?id=45876796))

## 3. What is unsolved (thin)
- **Low-stakes players who should play exploitatively, not GTO.** 1 quote, 1 source. "…for nl25-nl500 youre better off playing exploitatively…" ([thread](https://www.pokerchipforum.com/threads/feedback-on-poker-training-websites-gto-wizard-or-pokercoaching-com.141059/))

## Fix plan
| # | fix | size | skill | status |
| --- | --- | --- | --- | --- |
| 1 | Plain-language "why" under every graded decision: hand class, equity vs. range, price to call | S | replica-build | **done** (`explain()` in practice.js) |
| 2 | Free, offline, no daily hand limit (the original gives free users 10 hands/day) | S | — | **done** by design |
| 3 | Range drill on your own ranges: paste a range, get quizzed on it | M | replica-build | todo |
| 4 | Exploit mode: opponents play as a calling station or a nit instead of the strategy | M | replica-build | todo |

## Angle (for personal use, kept short)
1. **Recommended.** For low-stakes players who find solvers overwhelming and pricey, Spotwise is a free trainer that tells you *why* in plain words. Evidence: beginners + cost, 2 quotes, 1 source (thin).
2. For players who want to drill the ranges they actually use, quiz yourself on your own charts. Evidence: 1 quote (thin).
3. For NL25–NL500 regulars, train against the leaks real opponents have, not against perfection. Evidence: 1 quote (thin).
