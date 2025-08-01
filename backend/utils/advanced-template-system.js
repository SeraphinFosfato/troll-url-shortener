// Sistema template avanzato con vincoli temporali
const crypto = require('crypto');

class AdvancedTemplateSystem {
  constructor() {
    this.templates = this.initializeTemplates();
    this.timePresets = {
      '30s': 30,
      '1min': 60, 
      '2min': 120,
      '5min': 300,
      '10min': 600
    };
    this.expiryPresets = {
      '1h': 1/24,
      '1d': 1,
      '3d': 3, 
      '7d': 7
    };
  }

  initializeTemplates() {
    return {
      // Template atomici
      timer_simple: {
        id: 'timer_simple',
        type: 'atomic',
        category: 'timer',
        minDuration: 15,
        maxDuration: 60,
        stepSize: 5,
        estimatedTime: (duration) => duration,
        generateDuration: (targetTime, constraints) => {
          // Usa targetTime come base, poi aggiusta ai vincoli
          let duration = Math.round(targetTime / 5) * 5; // Round to 5s steps
          duration = Math.max(duration, 15); // Min 15s
          duration = Math.min(duration, 60); // Max 60s
          
          // Se targetTime è troppo grande per un singolo timer, usa max
          if (targetTime > 60) duration = 60;
          
          return duration;
        }
      },

      timer_punish: {
        id: 'timer_punish',
        type: 'atomic', 
        category: 'timer',
        minDuration: 20,
        maxDuration: 45,
        stepSize: 5,
        estimatedTime: (duration) => duration * 1.5, // Fattore punizione
        generateDuration: (targetTime, constraints) => {
          // Timer punitivo: usa targetTime ma con limiti più stretti
          let duration = Math.round(targetTime / 5) * 5;
          duration = Math.max(duration, 20); // Min 20s
          duration = Math.min(duration, 45); // Max 45s
          
          if (targetTime > 45) duration = 45;
          
          return duration;
        }
      },

      click_simple: {
        id: 'click_simple',
        type: 'atomic',
        category: 'click',
        clicksPerSecond: 5, // Stima cattiva: 5 click/sec
        minClicks: 3,
        maxClicks: 15,
        estimatedTime: (clicks) => Math.ceil(clicks / 5), // 5 click/sec
        generateClicks: (targetTime, constraints) => {
          // Calcola click basati su targetTime (5 click/sec stima cattiva)
          let clicks = Math.max(Math.floor(targetTime * 5), 3); // Min 3 click
          clicks = Math.min(clicks, 15); // Max 15 click
          return clicks;
        }
      },

      click_drain: {
        id: 'click_drain',
        type: 'atomic',
        category: 'click',
        clicksPerSecond: 3, // Più lento per drain
        minClicks: 10,
        maxClicks: 30,
        estimatedTime: (clicks) => Math.ceil(clicks / 3),
        generateClicks: (targetTime, constraints) => {
          // Click drain: più lento (3 click/sec)
          let clicks = Math.max(Math.floor(targetTime * 3), 10); // Min 10 click
          clicks = Math.min(clicks, 30); // Max 30 click
          return clicks;
        }
      },

      // Template compositi
      timer_then_click: {
        id: 'timer_then_click',
        type: 'composite',
        components: ['timer_simple', 'click_simple'],
        estimatedTime: (components) => components.reduce((sum, c) => sum + c.estimatedTime, 0),
        generateSequence: (targetTime, constraints) => {
          const timerTime = Math.floor(targetTime * 0.6); // 60% timer
          const clickTime = targetTime - timerTime;
          
          const timer = this.generateAtomicTemplate('timer_simple', timerTime, constraints);
          const click = this.generateAtomicTemplate('click_simple', clickTime, constraints);
          
          return [timer, click];
        }
      },

      click_then_timer: {
        id: 'click_then_timer',
        type: 'composite', 
        components: ['click_simple', 'timer_simple'],
        estimatedTime: (components) => components.reduce((sum, c) => sum + c.estimatedTime, 0),
        generateSequence: (targetTime, constraints) => {
          const clickTime = Math.floor(targetTime * 0.4); // 40% click
          const timerTime = targetTime - clickTime;
          
          const click = this.generateAtomicTemplate('click_simple', clickTime, constraints);
          const timer = this.generateAtomicTemplate('timer_simple', timerTime, constraints);
          
          return [click, timer];
        }
      },

      double_timer: {
        id: 'double_timer',
        type: 'composite',
        components: ['timer_simple', 'timer_punish'],
        estimatedTime: (components) => components.reduce((sum, c) => sum + c.estimatedTime, 0),
        generateSequence: (targetTime, constraints) => {
          const simpleTime = Math.floor(targetTime * 0.5);
          const punishTime = Math.floor(targetTime * 0.5);
          
          const simple = this.generateAtomicTemplate('timer_simple', simpleTime, constraints);
          const punish = this.generateAtomicTemplate('timer_punish', punishTime, constraints);
          
          return [simple, punish];
        }
      }
    };
  }

  // Calcola limiti step dinamici basati su tempo
  calculateMaxSteps(targetTimeSeconds) {
    if (targetTimeSeconds <= 30) return 2;
    if (targetTimeSeconds <= 60) return 3;
    if (targetTimeSeconds <= 120) return 4;
    return 5;
  }

  // Genera seed migliorato per RNG
  generateImprovedSeed(fingerprint, shortId) {
    const components = [
      Date.now(),
      fingerprint,
      shortId,
      Math.random(),
      process.hrtime.bigint().toString()
    ];
    
    const rawSeed = components.join('|');
    return crypto.createHash('sha256').update(rawSeed).digest('hex');
  }

  // RNG con seed migliorato
  createSeededRNG(seed) {
    let state = parseInt(seed.substring(0, 8), 16);
    return function() {
      state = (state * 1664525 + 1013904223) % Math.pow(2, 32);
      return state / Math.pow(2, 32);
    };
  }

  // Genera template atomico con vincoli
  generateAtomicTemplate(templateId, targetTime, constraints = {}) {
    const template = this.templates[templateId];
    if (!template || template.type !== 'atomic') return null;

    const logger = require('./debug-logger');
    
    if (template.category === 'timer') {
      const duration = template.generateDuration(targetTime, constraints);
      logger.debug('TEMPLATE', `Generated ${templateId}`, { targetTime, duration, constraints });
      
      return {
        type: template.category,
        subtype: templateId,
        duration,
        estimatedTime: template.estimatedTime(duration)
      };
    }
    
    if (template.category === 'click') {
      const clicks = template.generateClicks(targetTime, constraints);
      const estimatedTime = template.estimatedTime(clicks);
      
      logger.debug('TEMPLATE', `Generated ${templateId}`, { targetTime, clicks, estimatedTime, constraints });
      
      return {
        type: template.category,
        subtype: templateId,
        target: clicks,
        estimatedTime
      };
    }

    return null;
  }

  // Genera sequenza completa con vincoli
  generateConstrainedSequence(userParams, fingerprint, shortId) {
    const logger = require('./debug-logger');
    
    const targetTime = this.timePresets[userParams.timePreset] || 60;
    const maxSteps = this.calculateMaxSteps(targetTime);
    const requestedSteps = Math.min(userParams.steps || maxSteps, maxSteps);
    
    logger.info('TEMPLATE', 'Generating constrained sequence', {
      targetTime,
      requestedSteps,
      maxSteps,
      userParams
    });

    // Genera seed migliorato
    const seed = this.generateImprovedSeed(fingerprint, shortId);
    const rng = this.createSeededRNG(seed);
    
    // Calcola tempo per step
    const timePerStep = Math.floor(targetTime / requestedSteps);
    
    // Seleziona template con peso basato su vincoli
    const availableTemplates = this.getWeightedTemplates(timePerStep, requestedSteps, rng);
    const sequence = [];
    
    let remainingTime = targetTime;
    let remainingSteps = requestedSteps;
    
    for (let i = 0; i < requestedSteps; i++) {
      const stepTime = i === requestedSteps - 1 ? remainingTime : Math.floor(remainingTime / remainingSteps);
      
      // Seleziona template pesato
      const templateId = this.selectWeightedTemplate(availableTemplates, rng);
      const template = this.templates[templateId];
      
      let stepTemplate;
      
      if (template.type === 'atomic') {
        stepTemplate = this.generateAtomicTemplate(templateId, stepTime);
      } else if (template.type === 'composite') {
        // Per compositi, genera sotto-sequenza
        const subSequence = template.generateSequence(stepTime, {});
        stepTemplate = {
          type: 'composite',
          subtype: templateId,
          sequence: subSequence,
          estimatedTime: subSequence.reduce((sum, s) => sum + s.estimatedTime, 0)
        };
      }
      
      if (stepTemplate) {
        sequence.push(stepTemplate);
        remainingTime -= stepTemplate.estimatedTime;
        remainingSteps--;
      }
    }
    
    logger.info('TEMPLATE', 'Generated sequence', {
      sequence: sequence.map(s => ({ type: s.type, subtype: s.subtype, estimatedTime: s.estimatedTime })),
      totalEstimatedTime: sequence.reduce((sum, s) => sum + s.estimatedTime, 0),
      targetTime,
      seed: seed.substring(0, 8)
    });
    
    return {
      sequence,
      metadata: {
        targetTime,
        actualTime: sequence.reduce((sum, s) => sum + s.estimatedTime, 0),
        steps: requestedSteps,
        seed: seed.substring(0, 8)
      }
    };
  }

  // Calcola peso template basato su vincoli
  getWeightedTemplates(timePerStep, remainingSteps, rng) {
    const weights = {};
    
    Object.keys(this.templates).forEach(templateId => {
      const template = this.templates[templateId];
      let weight = 1;
      
      // Peso basato su tempo disponibile
      if (template.type === 'atomic') {
        if (template.category === 'timer') {
          weight = timePerStep >= 15 && timePerStep <= 60 ? 2 : 0.5;
        } else if (template.category === 'click') {
          const maxClicks = timePerStep * (template.clicksPerSecond || 5);
          weight = maxClicks >= template.minClicks ? 2 : 0.5;
        }
      } else if (template.type === 'composite') {
        // Compositi preferiti per step singoli con molto tempo
        weight = remainingSteps === 1 && timePerStep > 45 ? 3 : 1;
      }
      
      weights[templateId] = Math.max(weight, 0.1); // Min weight 0.1
    });
    
    return weights;
  }

  // Selezione template con peso
  selectWeightedTemplate(weights, rng) {
    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
    let random = rng() * totalWeight;
    
    for (const [templateId, weight] of Object.entries(weights)) {
      random -= weight;
      if (random <= 0) {
        return templateId;
      }
    }
    
    // Fallback
    return Object.keys(weights)[0];
  }
}

module.exports = new AdvancedTemplateSystem();