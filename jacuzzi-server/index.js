const express = require('express');
const axios = require('axios');

const GOLIOTH_API_KEY = process.env.GOLIOTH_API_KEY;
const GOLIOTH_PROJECT_ID = process.env.GOLIOTH_PROJECT_ID;
const DEFAULT_DEVICE = '62214be00e0fa12e47afdd40'; //process.env.GOLIOTH_DEFAULT_DEVICE;

const GOLIOTH_URL = `https://api.golioth.io/v1/projects/${GOLIOTH_PROJECT_ID}/devices`;

const DEFAULT_SHUTDOWN_BUBBLES = 15 * 1000; // 15 seconds
const DEFAULT_SHUTDOWN_USERS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_SHUTDOWN_CLEAN = 10 * 1000; // 30 * 60 * 1000; // 30 minutes

const MAX_TEMP = 41.0;



const getDevices = async () => {
    return await axios.get(GOLIOTH_URL, { 
        headers: { 'x-api-key': GOLIOTH_API_KEY }
    }).then(result => {
        return result.data;
    }).catch(e => {
        return null;
    });
}

const getDeviceData = async (deviceId, path) => {
    return await axios.get(`${GOLIOTH_URL}/${deviceId}/data/${path || ''}`, { 
        headers: { 'x-api-key': GOLIOTH_API_KEY }
    }).then(result => {
        return result.data;
    }).catch(e => {
        return null;
    });

}

const changeDeviceState = async (deviceId, path, state) => {
    // console.log('changeDeviceState ', deviceId, path, state)
    return await axios.post(`${GOLIOTH_URL}/${deviceId}/data/${path}`, state, { 
        headers: { 'x-api-key': GOLIOTH_API_KEY }
    }).then(result => {
        return result.data;
    }).catch(e => {
        return null;
    });
}

const deleteDeviceState = async (deviceId, path) => {
    // console.log('deleteDeviceState ', deviceId, path)
    return await axios.delete(`${GOLIOTH_URL}/${deviceId}/data/${path}`, { 
        headers: { 'x-api-key': GOLIOTH_API_KEY }
    }).then(result => {
        return result.data;
    }).catch(e => {
        // console.log('ERROR ', e);
        return null;
    });
}


const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.post('/data', async (req, res) => {

    /*
        - quando um apto ligar vai criar um timer automatico
        - quando receber "millis"
    */
    console.log(req.body);
    console.log();

    switch (req.body.path) {
        case "counter":
            // console.log('recebeu COUNTER', req.body.data, typeof req.body.data, req.body.data % 2 == 0);
            // console.log();
            // await changeDeviceState(DEFAULT_DEVICE, 'bubbles', req.body.data % 2 == 0 ? 'true' : 'false');
            // await changeDeviceState(DEFAULT_DEVICE, 'heater', req.body.data % 2 != 0 ? 'true' : 'false');
            break;

        case "millis":
            const deviceId = req.body.device_id;
            const deviceData = (await getDeviceData(req.body.device_id)).data;

            if (deviceData.temp >= MAX_TEMP) {
                console.log('EMERGENCY SHUTDOWN TEMP ', deviceData.temp);
                await changeDeviceState(deviceId, 'heater', 'false');
                await changeDeviceState(deviceId, 'bubbles', 'false');
            }

            if (deviceData.bubbles && deviceData.bubbles_shutdown) {
                const shutdownAt = new Date(deviceData.bubbles_shutdown);
                // console.log('SHUTDOWN! ', shutdownAt, ' now: ', new Date(), ' ', new Date() - shutdownAt);

                if (shutdownAt <= new Date()) {
                    if (deviceData.heater) {
                        console.log('TURNING OFF HEATER FIRST');
                        await changeDeviceState(deviceId, 'heater', 'false');
                        let shutdownAt = new Date().getTime() + DEFAULT_SHUTDOWN_BUBBLES;
                        await changeDeviceState(deviceId, 'bubbles_shutdown', shutdownAt.toString());
                    } else {
                        console.log('TURNING OFF BUBBLES');
                        await changeDeviceState(deviceId, 'bubbles', 'false');
                        await deleteDeviceState(deviceId, 'bubbles_shutdown');
                        await changeDeviceState(deviceId, 'clean', 'false');
                    }
                }
            }
            break;
    }
    res.set("Connection", "close");
    res.send('ok');
})

app.get('/device/:deviceTag/:command?', async (req, res) => {

    let waitForReply = false;
    // console.log('/CHANGE');
    if (!req.params.deviceTag) {
        res.send('Missing DeviceTag');
    }

    const device = (await getDevices()).list.filter(d => d.name.split('|')[0] == req.params.deviceTag)[0];

    const deviceData = (await getDeviceData(device.id)).data;
    const deviceName = device.name.split('|')[1];
    const deviceActive = deviceData.active && deviceData.level_sensor == 1;
    const deviceOn = deviceData.bubbles || deviceData.heater;
    const deviceBubblesActive = deviceData.bubbles; // && deviceData.level_sensor == 1 && deviceData.can_active_bubbles == 1;
    const deviceHeaterActive = deviceData.heater || deviceData.can_active_heater == 1;

    let text = [];
    
    const command = req.params.command;
    switch (command) {
        case '1':
        case '1️⃣':
            // Liga/Desliga Jacuzzi
            if (deviceActive) {
                if (deviceOn) {
                    if (deviceData.heater && !deviceData.bubbles) {
                        await changeDeviceState(device.id, 'heater', false.toString());
                    }
                    if (deviceData.bubbles) {
                        let shutdownAt = new Date().getTime();
                        await changeDeviceState(device.id, 'bubbles_shutdown', shutdownAt.toString());
                        text.push(`Iniciando desligamento da jacuzzi *${deviceName}*...`);
                        text.push('');
                        text.push(`Ela será desligada automaticamente em alguns segundos.`);
                    } else {
                        text.push(`Jacuzzi desligada com sucesso!`);
                    }

                } else {

                    if (!deviceData.bubbles) {
                        await changeDeviceState(device.id, 'bubbles', true.toString());
                    }
                    if (!deviceData.heater) {
                        await changeDeviceState(device.id, 'heater', true.toString());
                    }

                    let timeToShutdown = deviceData.shutdown_users ?? DEFAULT_SHUTDOWN_USERS;
                    let shutdownAt = new Date().getTime() + timeToShutdown;
                    await changeDeviceState(device.id, 'bubbles_shutdown', shutdownAt.toString());

                    text.push(`Jacuzzi *${deviceName}* foi ligada com sucesso.`);
                    text.push('');

                    if (deviceData.temp_target && deviceData.temp_target > 0) {
                        text.push(`🌡 *${deviceData.temp}ºC* programada para *${deviceData.temp_target}ºC*.`);
                        text.push('');
                    }
                    text.push(`Desligamento automático ${TimeAgo.inWords(shutdownAt)}.`);
                }
            } else {
                text.push(`🚨 A jacuzzi *${deviceName}* não está em funcionamento!`);
            }
            break;

        case '2':
        case '2️⃣':
            if (deviceActive) {

                // Temperatura
                let temp_target = parseFloat(req.query.temp || '40');

                // check temp_target between 5.0 and 40.0 degrees celsius
                if (temp_target > 40) temp_target = 40;
                if (temp_target < 5) temp_target = 5;
            
                // Se heater off ligar ele
                await changeDeviceState(device.id, 'temp_target', temp_target.toString());
                if (!deviceData.heater) {
                    await changeDeviceState(device.id, 'heater', true.toString());
                }
                // mudar temperatura padrao
                text.push(`Temperatura da jacuzzi *${deviceName}* ajustada para *${temp_target}ºC*.`);
            } else {
                text.push(`🚨 A jacuzzi *${deviceName}* não está em funcionamento!`);
            }
            break;

        case '3':
        case '3️⃣':
            // Ativa/Desativa Bubbles (limpeza filtro)
            // ONLY ADMIN MODE
            if (req.query.isAdmin) {
                const cleanStatus = !deviceData.clean;
                await changeDeviceState(device.id, 'clean', (cleanStatus).toString());
                await changeDeviceState(device.id, 'bubbles', (cleanStatus).toString());
                await changeDeviceState(device.id, 'heater', false.toString());

                text.push(`Limpeza do filtro da jacuzzi *${deviceName}* foi *${cleanStatus ? 'ativada' : 'desativada'}*.`);
                if (cleanStatus) {
                    let shutdownCleanAt = new Date().getTime() + DEFAULT_SHUTDOWN_CLEAN;
                    await changeDeviceState(device.id, 'bubbles_shutdown', shutdownCleanAt.toString());
                    text.push(`Desligamento automático ${TimeAgo.inWords(shutdownCleanAt)}.`);
                } else {
                    if (deviceData.active) {
                        text.push('');
                        text.push(`Jacuzzi está liberada para uso!`);
                    }
                }
            } else {
                text.push(`🚨 Apenas Administradores podem executar este comando!`);
            }
            break;

        case '4':
        case '4️⃣':
            // Ativa/Desativa funcionamento geral
            if (req.query.isAdmin) {
                await changeDeviceState(device.id, 'active', (!deviceData.active).toString());
                await changeDeviceState(device.id, 'bubbles', false.toString());
                await changeDeviceState(device.id, 'heater', false.toString());

                text.push(`Uso da Jacuzzi ${deviceName} ${!deviceData.active ? 'liberado' : 'bloqueado'}.`);
            } else {
                text.push(`🚨 Apenas Administradores podem executar este comando!`);
            }
            break;

        case '5':
        case '5️⃣':
            // Adiciona condômino
            if (req.query.isAdmin) {
            } else {
                text.push(`🚨 Apenas Administradores podem executar este comando!`);
            }
            break;

        case '6':
        case '6️⃣':
            // Remove condômino
            if (req.query.isAdmin) {
            } else {
                text.push(`🚨 Apenas Administradores podem executar este comando!`);
            }
            break;
        case '7':
        case '7️⃣':
            break;
        case '8':
        case '8️⃣':
            break;
        case '9':
        case '9️⃣':
            break;

        default:

            if (deviceActive) {
                text.push(`A jacuzzi *${deviceName}* está em funcionamento!`);
                text.push('');
                // text.push('');
                // text.push(`A hidromassagem está *${deviceBubblesActive ? 'LIGADA' : 'DESLIGADA'}*.`);
                // text.push(`O aquecimento está *${deviceHeaterActive ? 'LIGADO' : 'DESLIGADO'}*.`);
                // text.push('');

                if (deviceData.clean) {
                    text.push('');
                    text.push(`A jacuzzi está em *modo de limpeza*.`);
                    const shutdownAt = new Date(deviceData.bubbles_shutdown);
                    if (shutdownAt > new Date()) {
                        const timeAgo = TimeAgo.inWords(shutdownAt.getTime());
                        console.log('TIMEAGO: ', timeAgo);
                        text.push(`Conclusão será feita automaticamente ${timeAgo}.`);
                    }

                } else {
                    if (deviceData.bubbles && deviceData.bubbles_shutdown) {
                        const shutdownAt = new Date(deviceData.bubbles_shutdown);
                        if (shutdownAt > new Date()) {
                            const timeAgo = TimeAgo.inWords(shutdownAt.getTime());
                            console.log('TIMEAGO: ', timeAgo);
                            text.push(`A hidromassagem será desligada automaticamente ${timeAgo}.`);
                        }
                    }
    
                    if (deviceData.temp_target && deviceData.temp_target > 0 && (deviceData.can_active_heater == 1 && deviceData.heater)) {
                        text.push('');
                        text.push(`🌡 *${deviceData.temp}ºC* programada para *${deviceData.temp_target}ºC*.`);
                    } else {
                        // text.push(`O aquecedor está desligado, não pode ser ligado no momento ou a temperatura não foi programada.`);
                        text.push(`🌡 *${deviceData.temp}ºC*.`);
                    }

                    text.push('');
                    text.push('O que deseja fazer?');
                    text.push('');
                    text.push(`1️⃣ ${deviceOn || !deviceHeaterActive ? 'Desligar' : 'Ligar'} a jacuzzi.`);
                    text.push(`2️⃣ Mudar a 🌡 programada.`);
                    text.push('');
                    waitForReply = true;
                }
                
            } else {
                if (!deviceData.active) {
                    text.push(`A Jacuzzi *${deviceName}* não foi programada para funcionamento hoje.`);
                } else {
                    if (deviceData.level_sensor != 1) {
                        text.push(`A Jacuzzi *${deviceName}* não tem água suficiente para ativar seu funcionamento.`);                
                    }
                }
            }

            // ONLY ADMIN MODE
            if (req.query.isAdmin) {
                text.push('');
                text.push('');
                text.push('🚨 MODO ADMIN');
                text.push('');
                text.push(`3️⃣ ${deviceData.clean ? 'Desativar' : 'Ativar'} limpeza do filtro.`);
                text.push(`4️⃣ ${deviceActive ? 'Bloquear' : 'Liberar'} o funcionamento para condôminos.`);
                text.push(`5️⃣ 🔜 Adicionar condômino.`);
                text.push(`6️⃣ 🔜 Remover condômino.`);
                // text.push(`7️⃣ `);
                // text.push(`8️⃣ `);
                // text.push(`9️⃣ `);

                waitForReply = true;
            }
            
    }

    // res.contentType = 'application/json';
    res.contentType = 'text/json';
    res.json({
        result: text.join('\n'),
        waitForReply: waitForReply
    });
})

app.listen(3000, () => {
    console.log('App running port 3000');
})






var TimeAgo = (function() {
    var self = {};
    
    // Public Methods
    self.locales = {
      prefix: '',
      sufix:  '',
      
      seconds: 'em menos de um minuto',
      minute:  'no próximo minuto',
      minutes: 'em %d minutos',
      hour:    'na próxima hora',
      hours:   'em aproximadamente %d horas',
      day:     'em um dia',
      days:    'em %d dias',
      month:   'dentro de um mês',
      months:  'em %d meses',
      year:    'em um ano',
      years:   'em %d anos'
    };
    
    self.inWords = function(timeAgo) {
      var seconds = Math.abs(Math.floor((new Date() - parseInt(timeAgo)) / 1000)),
          separator = this.locales.separator || ' ',
          words = this.locales.prefix + separator,
          interval = 0,
          intervals = {
            year:   seconds / 31536000,
            month:  seconds / 2592000,
            day:    seconds / 86400,
            hour:   seconds / 3600,
            minute: seconds / 60
          };
      
      var distance = this.locales.seconds;
      
      for (var key in intervals) {
        interval = Math.floor(intervals[key]);
        
        if (interval > 1) {
          distance = this.locales[key + 's'];
          break;
        } else if (interval === 1) {
          distance = this.locales[key];
          break;
        }
      }
      
      distance = distance.replace(/%d/i, interval);
      words += distance + separator + this.locales.sufix;
  
      return words.trim();
    };
    
    return self;
  }());
  