// MASCP.Service.BeginCaching();

MASCP.BatchRead = function()
{
    this._make_readers();
    // confirmed_mods holds the experimentally-confirmed modifications
    this.confirmed_mods = {};
};

MASCP.BatchRead.prototype._make_readers = function() {
    this._readers = [];

    var rdr,rdr_id;
    for (rdr_id in READER_CONF) {
        if (READER_CONF.hasOwnProperty(rdr_id) && rdr_id != MASCP.TairReader) {
            rdr = READER_CONF[rdr_id];
            var clazz = rdr.definition;
            var reader = new clazz(null, rdr.url);
            this._readers.push(reader);
        }
    }

};


// For every event for a particular class (or null for all classes), bind
// this function to run. e.g. do something whenever a resultReceived for all MASCP.PhosphatReader
// We use this to pass resultReceived bindings from multiple.html

MASCP.BatchRead.prototype.bind = function(ev, clazz, func) {
    if (ev == 'resultReceived') {
        ev = '_resultReceived';
    }
    if (ev == 'error') {
        ev = '_error';
    }
    for (var i = 0; i < this._readers.length; i++ ) {
        if (! clazz || this._readers[i].__class__ == clazz) {
            this._readers[i].bind(ev,func);
        } else if (clazz == MASCP.Modhunter && modHunter) {
            modHunter.bind(ev,func);
        }
    }
};

MASCP.BatchRead.prototype.retrieve = function(agi, modHunter, opts) {

    var self = this;

    // If a call is already in progress, add a handler to make next call when current is complete
    if (self._in_call) {
        var self_func = arguments.callee;
        bean.add(self,'resultReceived', function() {
            bean.remove(self,'resultReceived',arguments.callee);
            self_func.call(self,agi,modHunter,opts);
        });
        return;
    }

    self._in_call = true;

    var modhunter_done = function() {
        self._in_call = false;
        bean.fire(modHunter,'agiComplete');
        bean.fire(self,'resultReceived');
    };

    var tair_error = function(e) {
        if (this._tries < 1) {
            this._tries++;
            var trRdr = this;
            this._timeoutID = window.setTimeout(trRdr.retrieve(), 300);
        } else {
            self._in_call = false;
            bean.fire(modHunter, 'agiNotFound');
            bean.fire(self,'resultReceived');
            console.log('"'+agi+'":');
            console.log('agi not found');
        }
    };

    if ( ! opts ) {
        opts = {};
    }

    // Initialize modHunter with protein sequence from tairReader
    var tairReader = new MASCP.TairReader(agi,MASCP.LOCALSERVER ? '/data/latest/gator' : null);
    tairReader._tries = 1;
    tairReader.bind('resultReceived', function() {
        modHunter.loadSequence(modHunter, this.result.getSequence());
    });
    tairReader.bind('error',tair_error);
    tairReader.agi = agi;
    tairReader.retrieve();

    // for a single reader, events: single_success
    // bound for all readers, events: error, success

    var result_count = self._readers.length;

    var trigger_done = function() {
        var self = this;
        if (typeof modHunter.whole_sequence != 'undefined') {
            modHunter.countCoverage(modHunter, this);
            if (result_count === 0) {
                if (opts.success) {
                    opts.success.call();
                }
                modHunter.bind('scoresCalculated',modhunter_done);
                modHunter.calcScores();
            }
        } else {
            modHunter.bind('sequenceLoaded',function (e) { trigger_done.call(self); });
        }
    };

    var res_received = function() {
        bean.fire(this,'_resultReceived');
        bean.remove(this,'resultReceived');
        result_count -= 1;
        trigger_done.call(this);
    };

    var err_received = function() {
        bean.fire(this,'_error');
        bean.remove(this,'error');
        result_count -= 1;
        trigger_done.call(this);
    };

    for (var i = 0; i < this._readers.length; i++ ) {
        var a_reader = this._readers[i];

        a_reader.unbind('resultReceived');
        a_reader.unbind('error');

        a_reader.result = null;
        a_reader.agi = agi;
                    
        if (opts.single_success) {
            a_reader.bind('resultReceived',opts.single_success);
        }
        if (opts.error) {
            a_reader.bind('error', opts.error);
        }

        a_reader.bind('resultReceived',res_received);
        a_reader.bind('error',err_received);

        a_reader.retrieve();
    }

    return self;
};
