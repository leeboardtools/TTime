/* 
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */

/* global fetch, Promise */

'use strict';


//
// TODO: Add stop selection:
//  Want a list of stops (filter by geo location?)
//  For each stop, will need the list of routes + direction (maybe even end point?)
//
//  Maybe also be able to filter routes from the stop.
//
// Or maybe the other way around, pick a route (with direction)
// then pick the stops of interest?
// Could then add a name to the stop ids/routes, and store away.

var activeStopIds = [];

// These are the routes predicted to depart the active stops.
//  {
//      'route':
//      'departTime':
//      'stopId':
//      'directionId':  0 or 1
//      'directionName':
//  }
var routeEntries = [];

var lastPredictionUpdateTime;

// Information about particular stops.
//  key: stopId
//  value: Map {
//          key: route
//          value: {
//              arriveTimes: Set
//              departTimes: Set
//          }
//      }
var stopEntries = new Map();

// Information about particular routes.
//  key: route
//  value: {
//      directions: [
//              {
//                  name:
//                  routeType:
//                  routeTypeId:    // 0 - light rail, 1 - heavy rail, 2 - commuter rail, 3 - bus, 4 - ferry
//                  longName:
//                  shortName:
//                  
//                  stopIds: Set 
//                  trips: Map({
//                      key: tripId
//                      value: {
//                          stopIds: []
//                      }
//                  }
//              },
//              ...
//          ]
//      }
var routeInfoEntries = new Map();



function setActiveStopIds(stops) {
    if (stops.toString() !== activeStopIds.toString()){
        activeStopIds = stops;
        stopEntries.clear();
        
        var storage = window.localStorage;
        if (storage) {
            try {
                storage.setItem('activeStopIds', activeStopIds.toString());
            } catch(e) {
                
            }
        }
    }
}

function editRouteInfoEntry(routeId) {
    let routeInfoEntry = routeInfoEntries.get(routeId);
    if (!routeInfoEntry) {
        routeInfoEntry = {
            directions: [],
            tripIds: new Map(),
            stopIds: new Set()
        };
        routeInfoEntries.set(routeId, routeInfoEntry);
    }
    
    return routeInfoEntry;
}


function editTripInfoEntry(routeInfoEntry, tripId) {
    var tripInfoEntry = routeInfoEntry.tripIds.get(tripId);
    if (!tripInfoEntry) {
        tripInfoEntry = {
            stopIds: []
        };
        routeInfoEntry.tripIds.set(tripId, tripInfoEntry);
    }
    
    return routeInfoEntry;
}


/**
 * Fetches routeInfoEntries with all the route ids and the basic route information (no trips, schedules, etc.)
 * @returns {Promise}
 */
function fetchRoutes() {
    var path = 'https://api-v3.mbta.com/routes';
    
    return fetch(path)
        .then(function(response) {
            return response.json();
        })
        .then(function(myJson) {
            processRoutesResponse(myJson);
        });
}

/**
 * Handles the actual processing of the route JSON results.
 * @param {Object} myJson
 * @returns {undefined}
 */
function processRoutesResponse(myJson) {
    var data = myJson.data;
    
    for (let routeData of data) {
        let routeId = routeData.id;
        
        let routeInfoEntry = editRouteInfoEntry(routeId);
        
        routeInfoEntry.routeId = routeId;
        routeInfoEntry.routeType = routeData.attributes.type;
        routeInfoEntry.routeTypeName = routeData.attributes.description;
        routeInfoEntry.longName = routeData.attributes.long_name;
        routeInfoEntry.shortName = routeData.attributes.short_name;
        
        for (let i = 0; i < routeData.attributes.direction_names.length; ++i) {
            if (!routeInfoEntry.directions[i]) {
                routeInfoEntry.directions[i] = {};
            }
            routeInfoEntry.directions[i].name = routeData.attributes.direction_names[i];
        }
    }
    
    console.log("processRoutesResponse()");
}


/**
 * Fetches the route entry in routeInfoEntry for a routeId with the schedule information for
 * a specific direction.
 * @param {String} routeId  The route id.
 * @param {Number} direction    The direction to load.
 * @returns {Promise}
 */
function fetchRouteStops(routeId, direction) {
    var path = 'https://api-v3.mbta.com/schedules?sort=stop_sequence&filter%5Bdirection_id%5D=' + direction 
            + '&filter%5Broute%5D=' + routeId;
    
    return fetch(path)
        .then(function(response) {
            return response.json();
        })
        .then(function(myJson) {
            processScheduleResponse(myJson, routeId, direction);
        });
}

/**
 * Handles the processing of the JSON results from the fetchRouteStops() call.
 * @param {String} json
 * @param {String} routeId
 * @param {Number} direction
 * @returns {undefined}
 */
function processScheduleResponse(json, routeId, direction) {
    var data = json.data;
    
    for (let stop of data) {
        let tripId = stop.trip.data.id;
        let stopId = stop.stop.data.id;

        let routeInfoEntry = editRouteInfoEntry(routeId);
        routeInfoEntry.stopIds.add(stopId);
        
        let tripInfoEntry = editTripInfoEntry(routeInfoEntry, tripId);
        tripInfoEntry.stopIds[stop.attributes.stop_sequence] = stopId;
    }
    
    console.log("processScheduleResponse()");
}


/**
 * Fetches the schedule times in stopEntries for one or more routes at a given stop id.
 * @param {String} stopId
 * @param {String []} routes
 * @returns {Promise}
 */
function fetchStopRouteSchedules(stopId, routes) {
    var path = 'https://api-v3.mbta.com/schedules?filter%5Bstop%5D=' + stopId;
    path += '&filter%5Broute%5D=';
    
    var isFirst = true;
    for(let route of routes) {
        if (isFirst) {
            isFirst = false;
        }
        else {
            path += '%2C';
        }
        path += route;
    }
    
    var result = fetch(path)
        .then(function(response) {
            return response.json();
        })
        .then(function(myJson) {
            processStopRouteSchedulesResult(myJson);
        });
        
        
    if (!stopEntries.get(stopId)) {
        var path = 'https://api-v3.mbta.com/stops/' + stopId;
        var promise = fetch(path)
                .then(function(response) {
                    return response.json();
                })
                .then(function(myJson) {
                    processStopResult(myJson);
                });
        result = Promise.all([result, promise]);
    }
    
    return result;
}

/**
 * Handles processing the JSON result for a given /stops/stopId, updating the stop entry
 * in stopEntries.
 * @param {String} json
 * @returns {undefined}
 */
function processStopResult(json) {
    var data = json.data;
    var stopId = data.id;
    var name = data.attributes.name;
    
    var stopEntry = stopEntries.get(stopId);
    if (!stopEntry) {
        stopEntry = new Map();
        stopEntries.set(stopId, stopEntry);
    }

    stopEntry.name = name;
    
    console.log('processStopResult()');
}

/**
 * Handles processing the JSON result for a given /schedules?filter[stop]=stopId&filter[route]=routeId...
 * @param {String} json
 * @returns {undefined}
 */
function processStopRouteSchedulesResult(json) {
    var data = json.data;
    for (let item of data) {
        var stopId = item.relationships.stop.data.id;
        var route = item.relationships.route.data.id;
        
        var arrivalTimeStamp = new Date(item.attributes.arrival_time);
        var departureTimeStamp = new Date(item.attributes.departure_time);
        
        var stopEntry = stopEntries.get(stopId);
        if (!stopEntry) {
            stopEntry = new Map();
            stopEntries.set(stopId, stopEntry);
        }
        
        var routeEntry = stopEntry.get(route);
        if (!routeEntry) {
            routeEntry = {
                'arriveTimes': new Set(),
                'departTimes': new Set()
            };
            stopEntry.set(route, routeEntry);
        }
        
        routeEntry.arriveTimes.add(arrivalTimeStamp);
        routeEntry.departTimes.add(departureTimeStamp);
    }
    
    console.log('processStopRouteSchedulesResult()');
}


/**
 * Fetches the stop prediction information for the activeStopIds.
 * @returns {Promise}
 */
function fetchActiveStopsPredictions() {
    var path = 'https://api-v3.mbta.com/predictions?sort=departure_time&filter%5Bstop%5D=';
    for (let i = 0; i < activeStopIds.length; ++i) {
        if (i > 0) {
            path += '%2C';
        }
        path += activeStopIds[i];
    }
    
    return fetch(path)
        .then(function(response) {
            return response.json();
        })
        .then(function(myJson) {
            return processPredictionResult(myJson);
        });
}

/**
 * Handles processing the JSON result for the prediction information of the activeStopIds.
 * @param {String} json
 * @returns {Promise}
 */
function processPredictionResult(json) {
    var entries = [];
    var firstStops = new Map();
    var predictionIds = new Set();
    
    var schedulesToGet = new Map();
    
    // Gather up the routes and their departure times.
    var data = json.data;
    for (let item of data) {
        if (predictionIds.has(item.id)) {
            continue;
        }
        predictionIds.add(item.id);
        
        var time = item.attributes.departure_time;
        if (!time) {
            continue;
        }
        
        var timeStamp = new Date(time);        
        var route = item.relationships.route.data.id;
        if (!route) {
            continue;
        }
        
        var stopId = item.relationships.stop.data.id;
        var firstStop = firstStops.get(route);
        if (firstStop !== undefined) {
            if (firstStop !== stopId) {
                continue;
            }
        }
        else {
            firstStops.set(route, stopId);
        }
        
        entries.push({ 
            'route': route,
            'time': timeStamp,
            'stopId': stopId,
            'directionId': item.attributes.direction_id
        });
        
        var stopEntry = stopEntries.get(stopId);
        if (!stopEntry || !stopEntry.has(route)) {
            var scheduleToGet = schedulesToGet.get(stopId);
            if (!scheduleToGet) {
                scheduleToGet = new Set();
                schedulesToGet.set(stopId, scheduleToGet);
            }
            
            scheduleToGet.add(route);
        }
    }
    
    var promises = [];
    schedulesToGet.forEach(function(value, key) {
        let promise = fetchStopRouteSchedules(key, value.values());
        promises.push(promise);
    });
    
    routeEntries = entries;
    lastPredictionUpdateTime = new Date();
    
    console.log('processPredictionResult');
    
    return Promise.all(promises);
}


/**
 * Reloads the route table.
 * @param {String} callContext  Debugging message.
 * @returns {undefined}
 */
function updateRouteTable(callContext) {
    if (callContext) {
        console.log("updateRouteTable() from " + callContext);
    }
    
    var tableElement = document.getElementById('busList');
    while (tableElement.rows.length > 1) {
        tableElement.deleteRow(-1);
    }
    
    // TODO: Add a spacer row every 30 minutes.
    
    for (let entry of routeEntries) {
        let row = tableElement.insertRow();
        let busCell = row.insertCell();
        let timeCell = row.insertCell();
        let scheduledTimeCell = row.insertCell();
        let stopCell = row.insertCell();

        busCell.innerHTML = entry.route;
        timeCell.innerHTML = dateToHHMMString(entry.time);
        
        var stopName = entry.stopId;
        var stopEntry = stopEntries.get(entry.stopId);
        if (stopEntry) {
            var routeEntry = stopEntry.get(entry.route);
            if (routeEntry && routeEntry.departTimes.size > 0) {
                var departTimes = new Array();
                routeEntry.departTimes.forEach(function(value) {
                    departTimes.push(value);
                });
                departTimes.sort();
                
                var minDelta = Math.abs(departTimes[0].valueOf() - entry.time);
                var minIndex = 0;
                for (let i = 1; i < departTimes.length; ++i) {
                    var delta = Math.abs(departTimes[i].valueOf() - entry.time);
                    if (delta < minDelta) {
                        minDelta = delta;
                        minIndex = i;
                    }
                }
                
                scheduledTimeCell.innerHTML = dateToHHMMString(departTimes[minIndex]);
            }
            
            if (stopEntry.name) {
                stopName = stopEntry.name;
            }
        }
        
        var routeInfoEntry = routeInfoEntries.get(entry.route);
        if (routeInfoEntry) {
            if ((entry.directionId >= 0) && (entry.directionId < routeInfoEntry.directions.length)) {
                busCell.innerHTML += ' ' + routeInfoEntry.directions[entry.directionId].name;
            }
        }
        
        stopCell.innerHTML = stopName;
    }
    
    var lastUpdateTimeElement = document.getElementById('lastUpdateTime');
    lastUpdateTimeElement.innerHTML = dateToHHMMString(lastPredictionUpdateTime, true);
}


function dateToHHMMString(time, includeSeconds) {
    if (!time) {
        return '';
    }
    var hours = time.getHours();
    var suffix = " AM";
    if (hours > 12) {
        hours -= 12;
        suffix = " PM";
    }
    hours = hours.toString();
    if (hours.length === 1) {
        hours = " " + hours;
    }

    var minutes = time.getMinutes().toString();
    if (minutes.length === 1) {
        minutes = "0" + minutes;
    }
    
    var seconds = "";
    if (includeSeconds) {
        seconds = time.getSeconds().toString();
        if (seconds.length === 1) {
            seconds = "0" + seconds;
        }
        seconds = ":" + seconds;
    }
    
    return hours + ':' + minutes + seconds + suffix;
}

function onUpdateBtn() {
    fetchActiveStopsPredictions().then(() => updateRouteTable("fetchActiveStopsPredictions()"));
}


var url = document.URL;
var fullQueryString = url.split('?')[1];
if (fullQueryString) {
    fullQueryString = fullQueryString.split('#')[0];
    
    let queryStrings = fullQueryString.split('&');
    queryStrings.forEach(function(queryString) {
        var keyValue = queryString.split('=');
        var key = keyValue[0];
        var value = keyValue[1];
        if (key === 'stop') {
            var stops = value.split(',');
            setActiveStopIds(stops);
        }
    });
}

if (!activeStopIds.length) {
    // Do we have stops from last time?
    var storage = window.localStorage;
    if (storage) {
        var stopIds = storage.getItem('activeStopIds');
        if (stopIds) {
            stopIds = stopIds.split(',');
            setActiveStopIds(stopIds);
        }
    }
    
}
//setActiveStopIds(['2158', '2159']);

fetchRoutes().then(() => updateRouteTable("fetchRoutes"));

setInterval(onUpdateBtn, 60000);

onUpdateBtn();
