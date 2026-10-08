'use strict';
module.exports = function productIntro(mode) {
  const tree = mode === 'decisions';
  return `<section class="product-intro" id="product-start" aria-labelledby="product-title">
    <div class="product-intro-copy"><p class="product-kicker">PREFRONTAL / FOR AI, DATA AND GOVERNANCE TEAMS</p>
    <h1 id="product-title">${tree ? 'Every decision.<br>Every check.' : 'Approved context.<br>Ready to reuse.'}</h1>
    <p class="product-definition">A proposed context service that turns business knowledge into approved, versioned records for AI applications.</p>
    <p class="product-reason">Reuse knowledge as models and tools change. Test cost, quality and control before expanding.</p>
    <div class="product-actions"><a class="primary-action" href="${tree ? '#submit' : '#full-architecture'}">${tree ? 'Follow the first decision' : 'Explore the architecture'} <span aria-hidden="true">↗</span></a><a class="secondary-action" href="${tree ? 'index.html#pilot-acceptance' : '#pilot-acceptance'}">Review the pilot <span aria-hidden="true">→</span></a></div>
    <p class="product-status-line">Product concept · pilot proposal · outcomes remain to be tested.</p></div>
    <div class="product-route" aria-label="The proposed product in three stages"><p class="route-kicker">ONE GOVERNED JOURNEY</p>
    <ol><li><span>01</span><div><strong>Submit the evidence</strong><p>Preserve the source and its meaning.</p></div></li><li><span>02</span><div><strong>Approve the record</strong><p>People review. Code enforces policy.</p></div></li><li><span>03</span><div><strong>Deliver permitted context</strong><p>Recheck access and current validity.</p></div></li></ol>
    <a class="route-reference" href="#why-prefrontal">Why the name Prefrontal? ↓</a></div>
  </section>`;
};
