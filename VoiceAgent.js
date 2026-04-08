
// ❌ Unknown intent fallback (ONLY if nothing matches later)
// voiceAgent.js
(() => {
  if (window.__ECOPRO_VOICE_AGENT_LOADED__) return;
  window.__ECOPRO_VOICE_AGENT_LOADED__ = true;

  const PRODUCTS = [
    {
      id: "pro1",
      name: "Tropical Vibe Shirt",
      price: 78,
      image: "pro1.png",
      brand: "adidas",
      tags: ["summer", "tropical", "casual", "bright", "vacation"],
      popularity: 0.82,
      details:
        "Tropical Vibe Shirt is a bright summer-style shirt with a lively look. It is a good choice if you want something eye-catching for casual outings or holidays."
    },
    {
      id: "pro2",
      name: "Palm Whisper Shirt",
      price: 50,
      image: "pro2.png",
      brand: "Levis",
      tags: ["summer", "casual", "budget", "light", "dailywear"],
      popularity: 0.91,
      details:
        "Palm Whisper Shirt is one of the best value options in the collection. It feels light, looks clean, and is suitable for everyday wear, especially in warm weather."
    },
    {
      id: "pro3",
      name: "Rustic Bloom Shirt",
      price: 20,
      image: "pro3.png",
      brand: "Lacoste",
      tags: ["budget", "casual", "floral", "light", "dailywear"],
      popularity: 0.72,
      details:
        "Rustic Bloom Shirt is the most budget-friendly choice. It is simple, floral, and lightweight, so it works well if you want something affordable for regular use."
    },
    {
      id: "pro4",
      name: "Cherry Mist Shirt",
      price: 90,
      image: "pro4.png",
      brand: "Zara",
      tags: ["premium", "party", "stylish", "date", "fashion"],
      popularity: 0.79,
      details:
        "Cherry Mist Shirt is the more premium and stylish option. It is better for fashion-focused looks, parties, or occasions where you want to stand out."
    }
  ];

  const LS_KEY = "ecopro_cart";

  const $ = (s) => document.querySelector(s);

  const agentLog = $("#agent-log");
  const micBtn = $("#agent-mic");
  const stopBtn = $("#agent-stop");

  let pendingOrder = false;
  let pendingRecommendation = null;
  let lastRecommendation = null;
  let lastDiscussedProduct = null;
  let recognition = null;
  let isSpeaking = false;
  let isListening = false;
  let lastCommand = "";
  let lastCommandTime = 0;
  let finalTranscript = "";
  let silenceTimer = null;

  const userProfile = {
    budget: null,
    style: null,
    occasion: null,
    prefersCheap: false,
    prefersPremium: false
  };

  function addMsg(text, who = "bot") {
    if (!agentLog) return;
    const div = document.createElement("div");
    div.className = `agent-msg ${who}`;
    div.textContent = text;
    agentLog.appendChild(div);
    agentLog.scrollTop = agentLog.scrollHeight;
  }

  function speak(text) {
    if (!text) return;

    speechSynthesis.cancel();
    isSpeaking = true;

    addMsg(text, "bot");

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;

    utterance.onend = () => {
      isSpeaking = false;
    };

    utterance.onerror = () => {
      isSpeaking = false;
    };

    speechSynthesis.speak(utterance);
  }

  function readCart() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveCart(items) {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
    updateBadge();
  }

  function updateBadge() {
    const badge = document.getElementById("cart-count");
    if (!badge) return;
    const total = readCart().reduce((sum, item) => sum + Number(item.qty || 1), 0);
    badge.textContent = total;
  }

  function addToCart(product, qty = 1) {
    const cart = readCart();
    const existing = cart.find((item) => item.product_id === product.id);

    if (existing) {
      existing.qty += qty;
    } else {
      cart.push({
        id: Date.now(),
        product_id: product.id,
        name: product.name,
        price: product.price,
        image: product.image,
        qty,
        created_at: new Date().toISOString()
      });
    }

    saveCart(cart);
  }

  function removeFromCart(productId) {
    const cart = readCart().filter((item) => item.product_id !== productId);
    saveCart(cart);
  }

  function placeOrder() {
    localStorage.removeItem(LS_KEY);
    updateBadge();
  }

  function getCartSummary() {
    const cart = readCart();

    if (!cart.length) return "Your cart is empty.";

    const total = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
    const items = cart.map((item) => `${item.qty} ${item.name}`).join(", ");

    return `Your cart has ${items}. Total is ${total.toFixed(2)} dollars.`;
  }

  function normalizeText(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractQty(text) {
    const numberWords = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10
    };

    const numericMatch = text.match(/\b(\d+)\b/);
    if (numericMatch) return Math.max(1, Number(numericMatch[1]));

    const lower = normalizeText(text);
    for (const word in numberWords) {
      if (lower.includes(word)) return numberWords[word];
    }

    return 1;
  }

  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }

    return dp[m][n];
  }

  function similarity(a, b) {
    if (!a || !b) return 0;
    const dist = levenshtein(a, b);
    return 1 - dist / Math.max(a.length, b.length);
  }

  function fuzzyFindProduct(text) {
    const lower = normalizeText(text);

    let best = null;
    let bestScore = 0;

    for (const product of PRODUCTS) {
      const name = normalizeText(product.name);
      const shortName = normalizeText(product.name.replace("shirt", ""));
      const scoreName = similarity(lower, name);
      const scoreShort = similarity(lower, shortName);

      let tagScore = 0;
      for (const tag of product.tags) {
        tagScore = Math.max(tagScore, similarity(lower, normalizeText(tag)));
      }

      const containsBonus =
        lower.includes(name) || lower.includes(shortName) ? 0.25 : 0;

      const score = Math.max(scoreName, scoreShort, tagScore) + containsBonus;

      if (score > bestScore) {
        best = product;
        bestScore = score;
      }
    }

    return bestScore >= 0.35 ? best : null;
  }

  function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
  }

  function extractPreferences(text) {
    const lower = normalizeText(text);

    const budgetMatch = lower.match(/under\s+(\d+)|below\s+(\d+)|less than\s+(\d+)|around\s+(\d+)/);
    const budget = budgetMatch ? Number(budgetMatch[1] || budgetMatch[2] || budgetMatch[3] || budgetMatch[4]) : null;

    let style = null;
    let occasion = null;

    if (lower.includes("summer")) style = "summer";
    if (lower.includes("party") || lower.includes("date")) occasion = "party";
    if (lower.includes("casual")) occasion = "casual";
    if (lower.includes("cheap") || lower.includes("budget")) userProfile.prefersCheap = true;
    if (lower.includes("premium") || lower.includes("stylish")) userProfile.prefersPremium = true;

    if (budget !== null) userProfile.budget = budget;
    if (style) userProfile.style = style;
    if (occasion) userProfile.occasion = occasion;

    return {
      budget: budget ?? userProfile.budget,
      style: style ?? userProfile.style,
      occasion: occasion ?? userProfile.occasion,
      prefersCheap: userProfile.prefersCheap,
      prefersPremium: userProfile.prefersPremium
    };
  }

  function productScore(product, prefs) {
    const budget = prefs.budget;
    const style = prefs.style;
    const occasion = prefs.occasion;

    const budgetFit =
      budget == null
        ? 0.5
        : product.price <= budget
          ? 1
          : Math.max(0, 1 - (product.price - budget) / Math.max(budget, 1));

    const styleFit = style && product.tags.includes(style) ? 1 : 0;
    const occasionFit = occasion && product.tags.includes(occasion) ? 1 : 0;
    const cheapFit = prefs.prefersCheap ? (1 - product.price / 100) : 0;
    const premiumFit = prefs.prefersPremium ? (product.price / 100) : 0;
    const popularityFit = product.popularity || 0.5;

    const linear =
      -0.8 +
      2.2 * budgetFit +
      1.4 * styleFit +
      1.2 * occasionFit +
      0.8 * cheapFit +
      0.8 * premiumFit +
      1.3 * popularityFit;

    return sigmoid(linear);
  }

  function recommendBestProduct(text) {
    const prefs = extractPreferences(text);

    const ranked = PRODUCTS
      .map((product) => ({
        product,
        score: productScore(product, prefs)
      }))
      .sort((a, b) => b.score - a.score);

    return ranked[0] || null;
  }

  function refreshCartUI() {
    if (typeof maybeRenderCartPage === "function") {
      try {
        maybeRenderCartPage();
      } catch (e) {
        console.log("Cart render skipped:", e);
      }
    }
  }

  function askFollowUpIfNeeded(text) {
    const prefs = extractPreferences(text);

    if (!prefs.budget && !prefs.style && !prefs.occasion) {
      speak("Sure. Before I recommend something, are you shopping for summer, casual wear, party wear, or a budget option?");
      return true;
    }

    return false;
  }

  function persuasivePitch(product, score) {
    if (!product) return "I could not find the right product yet.";

    if (product.id === "pro2") {
      return `I would go with ${product.name}. It is one of the best value options, easy for everyday wear, and priced nicely at ${product.price} dollars.`;
    }

    if (product.id === "pro4") {
      return `I would suggest ${product.name}. It feels more premium and stylish, so if you want something that stands out, this is the stronger pick at ${product.price} dollars.`;
    }

    if (product.id === "pro1") {
      return `I recommend ${product.name}. It has a bright summer vibe and gives a more eye-catching look for ${product.price} dollars.`;
    }

    return `A strong option is ${product.name}. It matches your request and has a recommendation score of ${(score * 100).toFixed(0)} percent.`;
  }

  function getProductExplanation(product) {
    if (!product) {
      return "I am not sure which product you mean. Please ask me about a specific shirt.";
    }

    if (product.id === "pro2") {
      return "Palm Whisper Shirt is a strong everyday option. It is light, affordable, easy to pair with casual outfits, and gives very good value for the price.";
    }

    if (product.id === "pro4") {
      return "Cherry Mist Shirt is more premium and fashion-forward. I would suggest it when you want something stylish for a party or a more dressed-up look.";
    }

    if (product.id === "pro1") {
      return "Tropical Vibe Shirt is brighter and more playful. It works well if you want a summer or vacation vibe instead of a plain everyday shirt.";
    }

    if (product.id === "pro3") {
      return "Rustic Bloom Shirt is the budget-friendly option. It is simple, light, and suitable if you want something affordable without spending much.";
    }

    return product.details || `${product.name} is a good option in this collection.`;
  }

  function isEmotionalOrHumanQuery(lower) {
    const patterns = [
      "i am sad",
      "im sad",
      "i am confused",
      "im confused",
      "i am upset",
      "im upset",
      "i am frustrated",
      "im frustrated",
      "i need help",
      "human",
      "customer care",
      "customer support",
      "support team",
      "talk to someone",
      "talk to a person",
      "talk to a human",
      "real person",
      "contact support",
      "contact page",
      "help me personally"
    ];

    return patterns.some((p) => lower.includes(p));
  }

  function handleCommand(text) {
    const lower = normalizeText(text);
    const now = Date.now();

    if (!lower) return;

    if (lower === lastCommand && now - lastCommandTime < 2000) {
      return;
    }

    lastCommand = lower;
    lastCommandTime = now;

    addMsg(text, "user");

    if (isEmotionalOrHumanQuery(lower)) {
      speak("I understand. For personal help or customer support, please go to the Contact page where you can reach the support team directly.");
      setTimeout(() => {
        const onContactPage = location.pathname.toLowerCase().includes("contact");
        if (!onContactPage) location.href = "contact.html";
      }, 1200);
      return;
    }

    if (
      lower.includes("tell me more") ||
      lower.includes("more about it") ||
      lower.includes("why this one") ||
      lower.includes("why that one") ||
      lower.includes("is it good") ||
      lower.includes("is it worth it") ||
      lower.includes("what is special") ||
      lower.includes("more details")
    ) {
      const product = pendingRecommendation || lastRecommendation || lastDiscussedProduct;
      if (!product) {
        speak("Sure. Tell me which shirt you want to know more about, and I will explain it.");
        return;
      }
      lastDiscussedProduct = product;
      speak(getProductExplanation(product));
      return;
    }

    if (pendingOrder && (lower.includes("yes") || lower.includes("confirm") || lower.includes("place it"))) {
      placeOrder();
      pendingOrder = false;
      refreshCartUI();
      speak("Your order has been placed successfully.");
      return;
    }

    if (pendingOrder && (lower.includes("no") || lower.includes("cancel"))) {
      pendingOrder = false;
      speak("Okay, I did not place the order.");
      return;
    }

    if (pendingRecommendation && (lower.includes("yes") || lower.includes("add it") || lower.includes("go ahead") || lower.includes("add that"))) {
      addToCart(pendingRecommendation, 1);
      refreshCartUI();
      speak(`Great choice. I have added ${pendingRecommendation.name} to your cart.`);
      lastRecommendation = pendingRecommendation;
      lastDiscussedProduct = pendingRecommendation;
      pendingRecommendation = null;
      return;
    }

    if (pendingRecommendation && (lower.includes("no") || lower.includes("something else") || lower.includes("another option"))) {
      pendingRecommendation = null;
      const secondBest = PRODUCTS.find((p) => !lastRecommendation || p.id !== lastRecommendation.id) || null;
      if (secondBest) {
        pendingRecommendation = secondBest;
        lastRecommendation = secondBest;
        lastDiscussedProduct = secondBest;
        speak(`Alright, then you may like ${secondBest.name}. It gives you a different feel and costs ${secondBest.price} dollars. Should I add it?`);
      } else {
        speak("Okay, tell me your budget or style and I will suggest another one.");
      }
      return;
    }

    if (lower.includes("show cart") || lower.includes("my cart")) {
      refreshCartUI();
      speak(getCartSummary());
      return;
    }

    if (lower.includes("place order") || lower.includes("checkout")) {
      const cart = readCart();

      if (!cart.length) {
        speak("Your cart is empty. Please add something first.");
        return;
      }

      pendingOrder = true;
      speak("I am ready to place your order. Please say yes to confirm or no to cancel.");
      return;
    }

    if (lower.includes("remove")) {
      const product = fuzzyFindProduct(lower);

      if (!product) {
        speak("I could not identify which item you want to remove.");
        return;
      }

      removeFromCart(product.id);
      refreshCartUI();
      lastDiscussedProduct = product;
      speak(`${product.name} has been removed from your cart.`);
      return;
    }

    if (lower.includes("add")) {
      const product = fuzzyFindProduct(lower);
      const qty = extractQty(lower);

      if (!product) {
        speak("I could not clearly understand the product name. Please say it again slowly.");
        return;
      }

      addToCart(product, qty);
      refreshCartUI();
      lastDiscussedProduct = product;
      speak(`Done. I added ${qty} ${product.name} to your cart.`);
      return;
    }

    if (
      lower.includes("recommend") ||
      lower.includes("suggest") ||
      lower.includes("best option") ||
      lower.includes("which shirt") ||
      lower.includes("what should i buy") ||
      lower.includes("what do you think")
    ) {
      if (askFollowUpIfNeeded(lower)) return;

      const best = recommendBestProduct(lower);

      if (!best) {
        speak("I could not find the right match. Tell me your budget or occasion.");
        return;
      }

      lastRecommendation = best.product;
      lastDiscussedProduct = best.product;
      pendingRecommendation = best.product;
      speak(`${persuasivePitch(best.product, best.score)} Would you like me to add it to your cart?`);
      return;
    }

    if (
      lower.includes("under") ||
      lower.includes("below") ||
      lower.includes("less than") ||
      lower.includes("budget") ||
      lower.includes("cheap") ||
      lower.includes("premium") ||
      lower.includes("summer") ||
      lower.includes("party") ||
      lower.includes("casual")
    ) {
      const best = recommendBestProduct(lower);

      if (!best) {
        speak("I could not find anything suitable. Please tell me more about your budget or style.");
        return;
      }

      lastRecommendation = best.product;
      lastDiscussedProduct = best.product;
      pendingRecommendation = best.product;
      speak(`${persuasivePitch(best.product, best.score)} Should I add it for you?`);
      return;
    }

    if (lower.includes("go to shop")) {
      speak("Opening the shop page.");
      setTimeout(() => {
        location.href = "shop.html";
      }, 800);
      return;
    }

    if (lower.includes("contact")) {
      speak("Sure, I will take you to the Contact page for human assistance.");
      setTimeout(() => {
        location.href = "contact.html";
      }, 800);
      return;
    }
speak("Sorry, I cannot help with that request. Please contact support or try asking about products.");
  }

  function initVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      addMsg("Voice recognition is not supported in this browser. Use Chrome for best results.", "bot");
      return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      isListening = true;
    };

    recognition.onend = () => {
      isListening = false;
    };

    recognition.onresult = (event) => {
      if (isSpeaking) return;

      let collected = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          collected += event.results[i][0].transcript + " ";
        }
      }

      if (!collected.trim()) return;

      finalTranscript += collected;

      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        const text = finalTranscript.trim();
        finalTranscript = "";

        try {
          recognition.stop();
        } catch (e) {
          console.log("Recognition stop skipped:", e);
        }

        if (text) {
          handleCommand(text);
        }
      }, 1500);
    };

    recognition.onerror = (event) => {
      isListening = false;

      if (event.error === "aborted" || event.error === "no-speech") {
        return;
      }

      if (!isSpeaking) {
        speak("Sorry, I could not hear clearly. Please try again.");
      }
    };

    if (micBtn) {
      micBtn.addEventListener("click", () => {
        if (isListening) return;

        speechSynthesis.cancel();
        isSpeaking = false;
        finalTranscript = "";
        clearTimeout(silenceTimer);

        addMsg("Listening... Speak your full sentence.", "bot");

        try {
          recognition.start();
        } catch (e) {
          console.log("Recognition start prevented:", e);
        }
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener("click", () => {
        try {
          recognition.stop();
        } catch (e) {
          console.log("Recognition stop skipped:", e);
        }

        speechSynthesis.cancel();
        isSpeaking = false;
        isListening = false;
        finalTranscript = "";
        clearTimeout(silenceTimer);
      });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateBadge();
    initVoice();
  });
})();