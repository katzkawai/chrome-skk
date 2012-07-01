function SKK(engineID) {
  this.engineID = engineID;
  this.context = null;
  this.currentMode = 'hiragana';
  this.previousMode = null;
  this.roman = '';
  this.preedit = '';
  this.okuriPrefix = '';
  this.okuriText = '';
  this.caret = null;
  this.entries = null;
}

SKK.prototype.commitText = function(text) {
  chrome.input.ime.commitText({contextID:this.context, text:text});
};

SKK.prototype.setComposition = function(text, cursor, args) {
  var allowed_fields = ['selectionStart', 'selectionEnd'];
  var obj = {
    contextID:this.context,
    text:text,
    cursor:cursor};
  args = args || {};
  for (var i = 0; i < allowed_fields.length; i++) {
    var field = allowed_fields[i];
    if (args[field]) {
      obj[field] = args[field];
    }
  }
  chrome.input.ime.setComposition(obj);
};

SKK.prototype.clearComposition = function() {
  chrome.input.ime.clearComposition({contextID:this.context});
};

SKK.prototype.updateCandidates = function() {
  if (this.internal_skk) {
    this.internal_skk.updateCandidates();
    return;
  }

  if (!this.entries || this.entries.index <= 2) {
    chrome.input.ime.setCandidateWindowProperties({
      engineID:this.engineID,
      properties:{
        visible:false
      }});
  } else {
    chrome.input.ime.setCandidateWindowProperties({
      engineID:this.engineID,
      properties:{
      visible:true,
      cursorVisible:false,
      vertical:true,
      pageSize:7
    }});
    var candidates = [];
    for (var i = 0; i < 7; i++) {
      if (i + this.entries.index >= this.entries.entries.length) {
        break;
      }
      var entry = this.entries.entries[this.entries.index + i];
      candidates.push({
        candidate:entry.word,
        id:this.entries.index + i,
        label:"asdfjkl"[i],
        annotation:this.entries.annotation
      });
    }
    chrome.input.ime.setCandidates({
      contextID:this.context, candidates:candidates});
  }
};

SKK.prototype.initDictionary = function() {
  initSystemDictionary('SKK-JISYO.L.gz');
};

SKK.prototype.lookup = function(reading, callback) {
  var result = lookupDictionary(reading);
  if (result) {
    callback(result.data);
  } else {
    callback(null);
  }
};

SKK.prototype.processRoman = function (key, table, emitter) {
  function isStarting(key) {
    var starting = false;
    for (var k in table) {
      if (k.indexOf(key) == 0) {
        starting = true;
      }
    }
    return starting;
  }

  this.roman += key;
  if (table[this.roman]) {
    emitter(table[this.roman]);
    this.roman = '';
    return;
  }

  if (this.roman.length > 1 && this.roman[0] == this.roman[1]) {
    emitter(table['xtu']);
    this.roman = this.roman.slice(1);
  }

  if (isStarting(this.roman, table)) {
    return;
  }

  if (this.roman[0] == 'n') {
    emitter(table['nn']);
  }

  if (table[key]) {
    emitter(table[key]);
    this.roman = '';
  } else if (isStarting(key, table)) {
    this.roman = key;
  } else {
    emitter(key);
    this.roman = '';
  }
};

SKK.prototype.modes = {};
SKK.prototype.primaryModes = [];
SKK.registerMode = function(modeName, mode) {
  SKK.registerImplicitMode(modeName, mode);
  SKK.prototype.primaryModes.push(modeName);
};
SKK.registerImplicitMode = function(modeName, mode) {
  SKK.prototype.modes[modeName] = mode;
};

SKK.prototype.switchMode = function(newMode) {
  if (newMode == this.currentMode) {
    // already switched.
    return;
  }

  if (this.inner_skk) {
    this.inner_skk.switchMode(newMode);
    return;
  }

  this.previousMode = this.currentMode;
  this.currentMode = newMode;
  var initHandler = this.modes[this.currentMode].initHandler;
  if (initHandler) {
    initHandler(this);
  }

  if (this.primaryModes.indexOf(this.previousMode) >= 0 &&
      this.primaryModes.indexOf(this.currentMode) >= 0) {
    chrome.input.ime.updateMenuItems({
      engineID:this.engineID,
      items:[
        {id:'skk-' + this.previousMode,
         label:this.modes[this.previousMode].displayName,
         style:'radio',
         checked:false},
        {id:'skk-' + this.currentMode,
         label:this.modes[this.currentMode].displayName,
         style:'radio',
         checked:true}
      ]});
  }
};

SKK.prototype.updateComposition = function() {
  if (this.inner_skk) {
    this.inner_skk.updateComposition();
    return;
  }

  var compositionHandler = this.modes[this.currentMode].compositionHandler;
  if (compositionHandler) {
    compositionHandler(this);
  } else {
    this.clearComposition();
  }
};

SKK.prototype.handleKeyEvent = function(keyevent) {
  // Do not handle modifier only keyevent.
  if (keyevent.key.charCodeAt(0) == 0xFFFD) {
    return false;
  }

  var consumed = false;
  if (this.inner_skk) {
    consumed = this.inner_skk.handleKeyEvent(keyevent);
  } else {
    var keyHandler = this.modes[this.currentMode].keyHandler;
    if (keyHandler) {
      consumed = keyHandler(this, keyevent);
    }
  }

  this.updateComposition();
  this.updateCandidates();
  return consumed;
};

SKK.prototype.createInnerSKK = function() {
  var outer_skk = this;
  var inner_skk = new SKK(this.engineID);
  inner_skk.commit_text = '';
  inner_skk.commit_cursor = 0;
  inner_skk.commitText = function(text) {
    inner_skk.commit_text =
      inner_skk.commit_text.slice(0, inner_skk.commit_cursor) +
      text + inner_skk.commit_text.slice(inner_skk.commit_cursor);
    inner_skk.commit_cursor += text.length;
  };

  inner_skk.setComposition = function(text, cursor, args) {
    var prefix = '\u25bc' + outer_skk.preedit + '\u3010' +
      inner_skk.commit_text;
    if (args && args.selectionStart) {
      args.selectionStart += prefix.length;
    }
    if (args && args.selectionEnd) {
      args.selectionEnd += prefix.length;
    }
    cursor += outer_skk.preedit.length + 2 + inner_skk.commit_cursor;
    outer_skk.setComposition(
      prefix + text + '\u3011', cursor, args);
  };
  inner_skk.clearComposition = function() {
    var text = '\u25bc' + outer_skk.preedit + '\u3010' +
      inner_skk.commit_text + '\u3011';
    var cursor = outer_skk.preedit.length + 2 + inner_skk.commit_cursor;
    outer_skk.setComposition(text, cursor);
  };

  var original_handler = SKK.prototype.handleKeyEvent.bind(inner_skk);
  inner_skk.handleKeyEvent = function(keyevent) {
    if (original_handler(keyevent)) {
      return true;
    }

    if (keyevent.key == 'Right' ||
        (keyevent.key == 'f' && keyevent.ctrlKey)) {
      if (inner_skk.commit_cursor < inner_skk.commit_text.length) {
        inner_skk.commit_cursor++;
      }
    } else if (keyevent.key == 'Left' ||
               (keyevent.key == 'b' && keyevent.ctrlKey)) {
      if (inner_skk.commit_cursor > 0) {
        inner_skk.commit_cursor--;
      }
    } else if (keyevent.key == 'Backspace') {
      if (inner_skk.commit_text == '') {
        outer_skk.finishInner(false);
      } else if (inner_skk.commit_cursor > 0) {
        inner_skk.commit_text =
          inner_skk.commit_text.slice(0, inner_skk.commit_cursor - 1) +
          inner_skk.commit_text.slice(inner_skk.commit_cursor);
        inner_skk.commit_cursor--;
      }
    } else if (keyevent.key == 'Enter') {
      outer_skk.finishInner(true);
    } else if (keyevent.key == 'Esc' ||
        (keyevent.key == 'g' && keyevent.ctrlKey)) {
      outer_skk.finishInner(false);
    }

    return true;
  };

  outer_skk.inner_skk = inner_skk;
};

SKK.prototype.finishInner = function(successfully) {
  if (successfully && this.inner_skk.commit_text.length > 0) {
    var new_word = this.inner_skk.commit_text;
    recordNewResult(this.preedit + this.okuriPrefix, {word:new_word});
    this.commitText(new_word + this.okuriText);
  }

  this.inner_skk = null;
  this.roman = '';
  this.okuriText = '';
  this.okuriPrefix = '';

  if (successfully) {
    this.preedit = '';
    this.switchMode('hiragana');
  } else {
    this.switchMode(this.previousMode);
  }
};
