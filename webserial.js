'use strict';

class Transport {
    constructor(device) {
        console.log("In Transport Constructor");
        this.device = device;
        this.slip_reader_enabled = false;
    }

    get_info(){
        const info = this.device.getInfo();
        return "WebSerial VendorID 0x"+info.usbVendorId.toString(16)+ " ProductID 0x"+info.usbProductId.toString(16);
    }

    slip_writer(data) {
        var count_esc = 0;
        var i = 0, j = 0;

        for (i = 0; i < data.length; i++) {
            if (data[i] === 0xC0 || data[i] === 0xDB) {
                count_esc++;
            }
        }
        var out_data = new Uint8Array(2 + count_esc + data.length);
        out_data[0] = 0xC0;
        j = 1;
        for (i = 0; i < data.length; i++, j++) {
            if (data[i] == 0xC0) {
                out_data[j++] = 0xDB;
                out_data[j] = 0xDC;
                continue;
            }
            if (data[i] == 0xDB) {
                out_data[j++] = 0xDB;
                out_data[j] = 0xDD;
                continue;
            }
                
            out_data[j] = data[i];
        }
        out_data[j] = 0xC0;
        return out_data;
    }

    write = async (data) => {
        const writer = this.device.writable.getWriter();
        var out_data = this.slip_writer(data);
        await writer.write(out_data.buffer);
        writer.releaseLock();
    }
    flush_input() {
        this.sliprd_state.state = "init";
        this.sliprd_state.outstanding = null;
    }
    
    _appendBuffer(buffer1, buffer2) {
        var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
        tmp.set(new Uint8Array(buffer1), 0);
        tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
        return tmp.buffer;
    }
   
    /* this function expects complete packet (hence reader reads for atleast 8 bytes. This function is
     * stateless and returns the first wellformed packet only after replacing escape sequence */
    slip_reader(data) {
        var i = 0;
        var data_start = 0, data_end = 0;
        var state = "init";
        var packet, temp_pkt;
        while (i < data.length) {
            if (state === "init" && data[i] == 0xC0) {
                data_start = i + 1;
                state = "valid_data";
                i++;
                continue;
            }
            if (state === "valid_data" && data[i] == 0xC0) {
                data_end = i - 1;
                state = "packet_complete";
                break;
            }
            i++;
        }
        if (state !== "packet_complete") {
            return new Uint8Array(0);
        }
        
        var temp_pkt = new Uint8Array(data_end - data_start + 1);
        var j = 0;
        for (i = data_start; i <= data_end; i++, j++) {
            if (data[i] === 0xDB && data[i+1] === 0xDC) {
                temp_pkt[j] = 0xC0;
                i++;
                continue;
            }
            if (data[i] === 0xDB && data[i+1] === 0xDD) {
                temp_pkt[j] = 0xDB;
                i++;
                continue;
            }
            temp_pkt[j] = data[i];
        }
        packet = temp_pkt.slice(0, j); /* Remove unused bytes due to escape seq */
        return packet;
    }

    read = async (timeout=0) => {
        let t;
        var packet = null;
        var value, done;
        console.log("Read with timeout " + timeout);
        const reader = this.device.readable.getReader();
        if (timeout > 0) {
            t = setTimeout(function() {
                reader.cancel();
                reader.releaseLock();
            }, timeout);
        }
        do {
            var o = await reader.read();
            value = o.value;
            done = o.done;
            if (packet == null) {
                packet = value;
            } else {
                var p = new Uint8Array(this._appendBuffer(packet.buffer, value.buffer));
                packet = p;
            }
            if (done) {
                break;
            }
        } while (packet.length < 8);

        if (done) {
            console.log("timed out");
            throw("timeout");
        } else {
            if (timeout > 0) {
                clearTimeout(t);
            }
            reader.releaseLock();
            if (this.slip_reader_enabled) {
                const val_final = this.slip_reader(packet);
                return val_final;
            } else {
                return packet;
            }
        }
    }

    setRTS = async (state) => {
        console.log("setRTS " + state);
        await this.device.setSignals({requestToSend:state});
    }

    setDTR = async (state) => {
        console.log("setDTR " + state);
        await this.device.setSignals({dataTerminalReady:state});
    }
    connect = async () => {
        await this.device.open({baudRate: 115200});
        this.baudrate = 115200;
    }
}

export { Transport };
