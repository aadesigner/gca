var VideoGalleryViewer = function(videosObservable, parentTemplateIdentifier = false) {
    const youtubeProvider = 'youtube',
          vimeoProvider = 'vimeo',
          mediaosProvider = 'mediaos';

    var self = this,
        $ = jQuery;

    self.videos = videosObservable;
    self.parentTemplateIdentifier = parentTemplateIdentifier; // used to differentiate videos that could appear more than once on the page. Basically the 'section' identifie

    self.elementsCache = [];

    self.currentIndex = ko.observable(0);
    self.players = [];

    self.isVisible = ko.observable(false);
    self.isVisible.subscribe(function(isVisible) {
        if (!isVisible) {
            self.pausePlayers();
            self.uninitializeVideo(self.videos()[self.currentIndex()]);
        }
    });

    self.previousTitle = ko.pureComputed(function() {
        var previousIndex = self.currentIndex() - 1;
        return previousIndex >= 0 ? self.videos()[previousIndex].title : false;
    });

    self.nextTitle = ko.pureComputed(function() {
        var nextIndex = self.currentIndex() + 1;
        return nextIndex < self.videos().length ? self.videos()[nextIndex].title : false;
    });


    self.showVideo = function(index, video) {
        if (self.initializeVideo(self.getVideoTemplateSelector(video), video)) {
            if(self.players[video.guid]) {
                self.players[video.guid].play();
            }
            
            self.currentIndex(index);
            self.isVisible(true);

            //track event in GA4
            self.gtagEvent('video_gallery_opened', 'Video Gallery Opened');
        }
    };

    self.goToVideoInDirection = function(direction) {
        self.pausePlayers();

        let nextIndex = false;
        let oldIndex = false;

        if('left' === direction) {
            nextIndex = self.currentIndex() - 1;
            nextIndex = nextIndex >= 0 ? nextIndex : false;

            //track event in GA4
            self.gtagEvent('video_gallery_slide_back', 'Navigate to Previous Video');
        } else if ('right' === direction) {
            nextIndex = self.currentIndex() + 1;
            nextIndex = nextIndex < self.videos().length ? nextIndex : false;

            //track event in GA4
            self.gtagEvent('video_gallery_slide_forward', 'Navigate to Next Video');
        }

        if(false === nextIndex) {
            return;
        }

        oldIndex = self.videos().length <= 1 ? false : self.currentIndex();

        self.handleChangeCurrentIndex(nextIndex, oldIndex);
    };

    self.handleChangeCurrentIndex = function(newIndex, oldIndex = false) {
        let video = self.videos()[newIndex];
        let oldVideo = (false !== oldIndex && oldIndex >= 0) ? self.videos()[oldIndex] : false;

        // initialize new/next player
        if (!self.players[video.guid]) {
            self.initializeVideo(self.getVideoTemplateSelector(video), video);
        }

        // remove current/previous player
        if (oldVideo) {
            self.uninitializeVideo(oldVideo);
            self.initializeVideo(self.getVideoTemplateSelector(video), video);
        }

        self.currentIndex(newIndex);
    };

    self.getAtIndex = function(index) {
        if (self.videos().length > 0) {
            return self.videos()[index];
        }
        return false;
    };

    /**
     * This will select a video DOM element based on the video guid and the parentTemplateIdentifier (if set) which exits to differentiate the same video from different sections on the same page
     * @param {*} video 
     * @returns 
     */
    self.getVideoTemplateSelector = function(video) {
        return document.querySelector('div[video_guid="'+ video.guid +'"]'+ (self.parentTemplateIdentifier ? '[parent_template_id="' + self.parentTemplateIdentifier + '"]' : ''));
    }

    self.initializeVideo = function(elements, video) {

        if(elements === false) {
            elements = self.elementsCache
        } else {
            self.elementsCache = elements
        }

        // this is for YouTube and Vimeo only
        $(elements).find('iframe').attr('id', video.guid);

        const videoProvider = video.provider.toLowerCase();

        if(videoProvider === youtubeProvider) {
            self.players[video.guid] = new VideoGalleryPlayerYoutube(video);
            return true;
        } else if (videoProvider === vimeoProvider) {
            self.players[video.guid] = new VideoGalleryPlayerVimeo(video);
            return true;
        } else if (videoProvider === mediaosProvider) {

            if (undefined !== video.oembedHtml) {
                // phpcs:ignore WordPressVIPMinimum.JS.HTMLExecutingFunctions.html -- oembedHtml comes from MMS service
                $(elements).find('.bat-video-gallery-oembed').html(video.oembedHtml);
            }

            self.players[video.guid] = new VideoGalleryPlayerGlimmer(video, elements);
            return true;
        }


        return false;
    };

    // uninitialize logic used for glimmerJS/mediaos videos
    self.uninitializeVideo = function(video) {
        if (self.players[video.guid] && video.provider === 'mediaos') {
            // clean up glimmerJS players
            if (self.players[video.guid].remove()) {
                // clean up glimmerJS player from DOM
                let videoElement = self.getVideoTemplateSelector(video);
                // phpcs:ignore WordPressVIPMinimum.JS.HTMLExecutingFunctions.html -- oembedHtml comes from MMS service
                $(videoElement).find('.bat-video-gallery-oembed').html(video.oembedHtml);

                // clean up viewmodel
                self.players[video.guid] = null;
            }
        }
    };

    self.alignVideosToViewport = function(elements) {
        var adjustVideoContainerToFitWindowHeight = function() {
            var controlsHeightPx = 170,
                topMarginHeightPx = parseFloat($('.modal-popup').css('padding-top')),
                windowHeight = $(window).height();

            var maxVideoHeightPx = windowHeight - (topMarginHeightPx + controlsHeightPx),
                maxVideoWidthPx = 16/9 * maxVideoHeightPx;

            $(elements).find('.bat-video-gallery-oembed').css({ 'width': maxVideoWidthPx + 'px' });
            $(elements).find('.bat-video-gallery-viewer-controls').css({ 'max-width': maxVideoWidthPx + 'px' });
        };

        adjustVideoContainerToFitWindowHeight();

        $(window).on('resize', adjustVideoContainerToFitWindowHeight);
    };

    self.pausePlayers = function() {
        // stop glimmer js players
        if (window.hearstPlayer && window.hearstPlayer.instances) {
            Object.values(window.hearstPlayer.instances).forEach(function(player) {
                player.pause();
            });
        }
        
        self.gtagEvent('video_player_closed', 'Video Player Closed');

        // stop all other players
        Object.values(self.players).forEach(function(player) {
            if (player) {
                player.pause();
            }
        });
    };

    self.maybeClosePopup = function(data, event) {
        var $target = $(event.target);

        if($target.is('.modal-content') || $target.closest('.modal-content').length > 0) {
            return false;
        } else {
            BAT.modal.hide($target.closest('.modal-cover'));
        }
    };

    self.gtagEvent = gtagEvent;
};

ko.bindingHandlers.isModalVisible = {
    init: function(element, valueAccessor) {
        var value = valueAccessor();

        jQuery(element).on('bat.modal.hide', function () {
            value(false);
        });
    },
    update: function(element, valueAccessor) {
        var isVisible = ko.unwrap(valueAccessor());

        if(isVisible) {
            BAT.modal.show(element);
        }
    }
};

//track GA4 events
const gtagEvent = function(eventName, eventCategory, videoObj = {}, sharedVideoData = {}) {
    if (typeof gtag === 'function') {
        gtag('event', eventName, {
            event_category: eventCategory,
            timestamp: new Date().getTime(),
            send_to: 'hdm_ga4',
            ...videoObj,
            ...sharedVideoData,
        });
    }
}

// Listen for HTML5 video events instead of custom Hearst player events
document.addEventListener('DOMContentLoaded', function() {
    // Map HTML5 video events to GA4 event names
    const videoEventsMapping = {
        'error': 'video_diagnostic_player_error',
        'play': 'video_playback_play_button',
        'pause': 'video_playback_pause_button',
        'volumechange': 'video_playback_volume_change',
        'ended': 'video_playback_q4',
        'loadedmetadata': 'video_playback_loaded',
    };

    // Find and attach event listeners to all video elements
    function attachVideoListeners() {
        const videoElements = document.querySelectorAll('video');

        videoElements.forEach(function(video) {
            // Set a unique id if not present
            if (!video.id) video.id = 'video-' + Math.random().toString(36).substr(2, 9);
            
            // Track quartile progress
            let quartileTracked = {
                start: false,
                q1: false,
                q2: false,
                q3: false
            };
            
            // Add event listeners for all standard video events
            Object.keys(videoEventsMapping).forEach(function(eventName) {
                video.addEventListener(eventName, function() {
                    trackVideoEvent(video, eventName);
                });
            });
            
            // Special handling for timeupdate to track quartiles
            video.addEventListener('timeupdate', function() {
                trackQuartiles(video);
            });
            
            // Handle mute/unmute
            video.addEventListener('volumechange', function() {
                if (video.muted) {
                    trackVideoEvent(video, 'mute', 'video_playback_mute');
                } else {
                    trackVideoEvent(video, 'unmute', 'video_playback_unmute');
                }
            });
        });
    }
    
    // Track video quartiles
    function trackQuartiles(video) {
        const quartileTracked = video.quartileTracked = (video.quartileTracked || {
            start: false,
            q1: false,
            q2: false,
            q3: false
        });
        
        const percent = video.currentTime / video.duration;
        
        if (!quartileTracked.start && percent > 0.05) {
            trackVideoEvent(video, 'played-q0', 'video_playback_start');
            quartileTracked.start = true;
        } else if (!quartileTracked.q1 && percent >= 0.05 && percent <= 0.25) {
            trackVideoEvent(video, 'played-q1', 'video_playback_q1');
            quartileTracked.q1 = true;
        } else if (!quartileTracked.q2 && percent >= 0.25 && percent <= 0.5) {
            trackVideoEvent(video, 'played-q2', 'video_playback_q2');
            quartileTracked.q2 = true;
        } else if (!quartileTracked.q3 && percent >= 0.5 && percent <= 0.75) {
            trackVideoEvent(video, 'played-q3', 'video_playback_q3');
            quartileTracked.q3 = true;
        }
    }
    
    // Track a video event with gtag
    function trackVideoEvent(videoElement, eventType, overrideEventName) {
        const eventName = overrideEventName || videoEventsMapping[eventType];

        if (!eventName) return;
        
        // Prevent duplicate events within a short time window
        const videoId = videoElement.dataset.videoId || videoElement.id;
        const eventKey = `${videoId}_${eventName}`;
        const now = Date.now();
        
        // Store last events in videoElement to avoid global state issues
        videoElement.lastEvents = videoElement.lastEvents || {};
        
        // Check if the same event was fired recently (within 250ms)
        if (videoElement.lastEvents[eventKey] && (now - videoElement.lastEvents[eventKey] < 250)) {
            return; // Skip duplicate event
        }
        
        // Update the timestamp for this event
        videoElement.lastEvents[eventKey] = now;
        
        const videoObj = {};
        
        // Add video view metric for video start
        if (eventName === 'video_playback_start') videoObj.vidVw = 1;
        
        // Add video play time for quartile events
        if (/q1|q2|q3/.test(eventName) && videoElement.duration) {
            const quartileDuration = Math.floor(videoElement.duration / 4);
            videoObj.vidPlyTm = quartileDuration;
        }
        
        // Build shared video data
        const sharedVideoData = {
            // Player metadata
            playerHeight: videoElement.clientHeight.toString(),
            playerWidth: videoElement.clientWidth.toString(),
            playerPosition: videoElement.getBoundingClientRect().top.toString(),
            playerVersion: 'HTML5',
            
            // Video data 
            videoDuration: videoElement.duration || 0,
            videoId: videoId,
            videoSource: videoElement.dataset.source || '',
            videoTitle: videoElement.dataset.title || videoElement.getAttribute('title') || '',
        };
        
        // Send GA4 event
        gtagEvent(eventName, eventName, videoObj, sharedVideoData);
    }
    
    // Initial setup
    attachVideoListeners();
    
    // Re-attach listeners when new videos might be added to the DOM
    const observer = new MutationObserver(function(mutations) {
        let newVideoFound = false;
        
        // Check mutations for added video elements
        mutations.forEach(mutation => {
            if (mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => {
                    // Check if the node is a video element
                    if (node.nodeName === 'VIDEO') {
                        newVideoFound = true;
                    }
                    // Check if the node contains video elements (if it's an Element)
                    else if (node.nodeType === Node.ELEMENT_NODE) {
                        const videos = node.querySelectorAll('video');
                        if (videos.length > 0) {
                            newVideoFound = true;
                        }
                    }
                });
            }
        });
        
        // Only call attachVideoListeners if we found new video elements
        if (newVideoFound) {
            attachVideoListeners();
        }
    });
    
    const videoGalleryElement = document.querySelector('#bat_listing_page_video_gallery');
    if (videoGalleryElement) {
        observer.observe(videoGalleryElement, { childList: true, subtree: true });
    } else {
        // Fallback to document.body if the target element doesn't exist
        observer.observe(document.body, { childList: true, subtree: true });
    }
});
;
var VideoGalleryViewModel = function(items, parentCommentModel = false) {
    var self = this;

    self.videos = ko.observableArray();
    self.parentCommentModel = parentCommentModel;

    self.add = function(video) {
        self.addAtIndex(video, self.videos().length);
    };

    self.addAtIndex = function(video, index) {
        //decode the video title in comment to remove the special characters
        video.title     = BaT_Theme.decodeHTML(video.title);
        video.ariaTitle = BaT_Theme.textVideo + ' ' + video.title;

        if(video.identifier !== undefined) {
            video.guid = video.identifier;
        }
        else {
            // Give videos a unique identifier
            video.guid = BaT_Theme.guid();
        }

        self.videos.splice(index, 0, video);
    };

    /**
     * Remove video from list and return the index at which it was removed
     * @param {string} videoIdentifier
     * @returns {integer} index where video was removed. -1 if nothing was removed
     */
    self.remove = function(videoIdentifier) {
        let videos = self.videos(),
            removedIndex = -1;

        for(var i = 0; i < videos.length; i++) {
            if(videos[i].identifier === videoIdentifier) {
                self.videos.splice(i, 1);
                removedIndex = i;
                break;
            }
        }
        return removedIndex;
    }

    self.removeAtIndex = function(videoIndexToRemove) {
        self.videos.splice(videoIndexToRemove, 1);
    };

    self.videoGalleryViewer = new VideoGalleryViewer(self.videos, self.parentCommentModel);

    self.showVideoGalleryViewer = function(index, video = false) {
        if (false === video) {
            video = self.videos()[index];
        }

        if (false === video || (undefined !== video.processingStatus && 'completed' !== video.processingStatus)) {
            return;
        }

        self.videoGalleryViewer.showVideo(index, video);
    };

    var items = items || [];
    items.forEach(function(item) {
        self.add(item);
    });

    function handleVideoChange(video) {
        const removedIndex = self.remove(video.identifier);
        if (removedIndex >= 0) {
            self.addAtIndex(video, removedIndex);
        }
    }

    BAT_WEBSERVICES_PUSHER.bind(true, 'video-transcoded', function(data) {
        handleVideoChange(data.video_data);
    });
};
;
(function($, _) {

window.VideoSubmissionViewModel = function(listingVideoPreviewUrl) {
    var self = this;

    self.newVideoViewModels = ko.observableArray([]);
    self.existingVideoIdentifiers = ko.pureComputed(function() {
        return self.newVideoViewModels().map(function(newVideoViewModel) {
            return newVideoViewModel.identifier();
        }).filter(function(identifier) {
            return identifier !== '';
        });
    });
    self.newVideoViewModels.push(new VideoSubmissionNewVideoViewModel(listingVideoPreviewUrl, self.existingVideoIdentifiers));

    self.addAnotherVideo = function() {
        self.newVideoViewModels.push(new VideoSubmissionNewVideoViewModel(listingVideoPreviewUrl, self.existingVideoIdentifiers));
    };

    self.removeVideoAtIndex = function(index) {
        self.newVideoViewModels.splice(index, 1);

        if (self.newVideoViewModels().length === 0) {
            self.addAnotherVideo();
        }
    };

    self.resetVideoData = function() {
        self.newVideoViewModels.removeAll();
        self.newVideoViewModels.push(new VideoSubmissionNewVideoViewModel(listingVideoPreviewUrl, self.existingVideoIdentifiers));
    };

    self.prepareVideoMetadataForSubmit = function() {
        // Save any in-process title changes
        self.newVideoViewModels().filter(function(newVideoViewModel) {
            return newVideoViewModel.videoState() === VideoSubmissionNewVideoViewModel.VIDEO_LOAD_STATES.LOADED
        }).map(function(loadedVideo) {
            return loadedVideo.updateTitleBeforeSubmit();
        });

        // Load all unloaded videos with URLs
        var loadMetadataPromises = self.newVideoViewModels().filter(function(newVideoViewModel) {
            return newVideoViewModel.videoState() !== VideoSubmissionNewVideoViewModel.VIDEO_LOAD_STATES.LOADED
                && newVideoViewModel.url() !== '';
        }).map(function(newVideoViewModel) {
            return newVideoViewModel.loadVideoMetadata();
        });

        return Promise.all(loadMetadataPromises).then(function(isVideoLoadedArray) {
            // Return true if all videos loaded successfully, and false if any failed.
            return _.every(isVideoLoadedArray);
        });
    };

    // Video previews
    self.videoGallery = new VideoGalleryViewModel();
    self.videoPreviewsData = ko.pureComputed(function() {
        return self.newVideoViewModels().map(function(newVideoViewModel) {
            return newVideoViewModel.videoPreviewData();
        }).filter(function(videoPreviewData) {
            return videoPreviewData !== false;
        });
    }).extend({trackArrayChanges: true});

    self.videoPreviewsData.subscribe(function(arrayChanges) {
        arrayChanges.forEach(function(arrayChange) {
            if(arrayChange.status === 'added') {
                self.videoGallery.addAtIndex(arrayChange.value, arrayChange.index);
            } else if(arrayChange.status === 'deleted') {
                self.videoGallery.removeAtIndex(arrayChange.index);
            }
        });
    }, self, 'arrayChange')

    self.showVideoPreview = function(index, data, event) {
        var videoPreviews = self.videoPreviewsData();

        for (var i = 0; i < videoPreviews.length; i++) {
            if(videoPreviews[i].identifier === data.identifier()) {
                self.videoGallery.showVideoGalleryViewer(i);
            }
        }
    };

    // Video count queries
    self.videoCount = ko.pureComputed(function() {
        return self.newVideoViewModels().map(function(newVideoViewModel) {
            return newVideoViewModel.url();
        }).filter(function(url) {
            return url !== '';
        }).length;
    });

    // Serialization
    self.serialized = ko.pureComputed(function() {
        return JSON.stringify(self.newVideoViewModels().filter(function(newVideoViewModel) {
            return newVideoViewModel.url() !== '';
        }).map(function(newVideoViewModel) {
            return newVideoViewModel.serialized();
        }));
    });
};

})(jQuery, lodash);;
(function($) {

window.CommentFormVideoControlsViewModel = function() {
    var self = this;

    self.isVisible = ko.observable(false);
    self.videoUploadViewModel = new VideoUploadViewModel();

    $(document).on('bat.comment.submitted', function() {
        self.videoUploadViewModel.resetVideoData();
    });

    // Exit confirmation
    self.isExitConfirmationVisible = ko.observable(false);

    self.showExitDialog = function(hideVideoControls, data, event) {
        if($('#uploaded_videos').val().trim().length === 0) {
            self.exit(hideVideoControls, data, event);
            return;
        }

        self.isExitConfirmationVisible(true);
    };

    self.exit = function(hideVideoControls, data, event) {
        hideVideoControls();

        self.videoUploadViewModel.resetVideoData();
        self.isExitConfirmationVisible(false);
    };

    self.cancelExit = function(data, event) {
        self.isExitConfirmationVisible(false);
    }
};

})(jQuery);
;
(function($) {

window.CommentFormViewModel = function() {
    var self = this;

    self.videoControlsViewModel = new CommentFormVideoControlsViewModel();

    self.showVideoControls = function() {
        self.videoControlsViewModel.isVisible(true);

        $('.bat-comment-media-buttons').hide();
    };

    self.hideVideoControls = function() {
        self.videoControlsViewModel.isVisible(false);

        $('.bat-comment-media-buttons').show();
    };

    $(document).on('bat.comment.submitted', function() {
        self.hideVideoControls();
    });
};

})(jQuery);
;
(function($) {

window.CommentVideoGalleryViewModel = function(items, parentCommentModel) {
    var self = this;

    self.items              = ko.observableArray();
    self.loadingVideos      = ko.observable(false);
    self.parentCommentModel = parentCommentModel;

    // Actions
    self.add = function(item) {
        self.items.push(item);
    };

    self.remove = function(item) {
        self.items.remove(item);
    };

    self.removeIds = function(ids) {
        self.items.removeAll(self.items().filter(function(item) {
            return -1 !== ids.indexOf(item.id);
        }));
    };

    /**
     * Update item and return index or -1
     * 
     * @param {*} item 
     * @returns {integer} index where video was removed. -1 if nothing was removed
     */
    self.updateItem = function(item) {
        for(let i = 0; i < self.items().length; i++) {
            if (self.items()[i].identifier === item.identifier) {
                self.items.valueWillMutate();
                self.items()[i] = item;
                self.items.valueHasMutated();

                return i;
            }
        }

        return -1;
    }

    /**
     * Refresh video item in this view-model and also in videoGallery view model
     * 
     * @param {object} video_data 
     */
    function handleVideoChange(video_data) {
        const pendingVideosPriorProcessing = self.items().find(item => item.processingStatus !== 'completed');
        const updatedIndex = self.updateItem(video_data);

        if(updatedIndex >= 0) {
            if(self.items().find(item => item.processingStatus !== 'completed') === undefined) {
                self.parentCommentModel.hasPendingVideos(false);

                if(pendingVideosPriorProcessing) {
                    const audio = new Howl({ src: [BAT_VMS.commentAudioUrl] });

                    if(audio) {
                        audio.play();
                    }
                }
            }

            if(self.items().find(item => item.processingStatus === 'error') !== undefined) {
                self.parentCommentModel.hasErrorVideos(true);
            }
        }
    }

    function loadAjaxVideos(itemsUrl, callback) {
        self.loadingVideos(true);

        var loadDelayMs = Math.floor(Math.random() * 8 * 1000); /* 0 - 8 seconds */

        setTimeout(function () {
            jQuery.ajax({
                type: 'GET',
                url: itemsUrl,
                success: function (data) {
                    data.videos.forEach(function(item) {
                        self.add(item);

                        // Set hasPendingVideos to true if any of the video is still processing
                        if(item.processingStatus !== 'completed') {
                            self.parentCommentModel.hasPendingVideos(true);
                        }

                        if(item.processingStatus === 'error') {
                            self.parentCommentModel.hasErrorVideos(true);
                        }
                    });

                    self.loadingVideos(false);
                    callback(data.videos);
                },
            });
        }, loadDelayMs);
    }

    if (typeof items === 'string') {
        self.videoGallery = new VideoGalleryViewModel([]);

        loadAjaxVideos(items, function(videos) {
            videos.forEach(function(video) {
                self.videoGallery.add(video);
            });
        });
    } else {
        items.forEach(function(item) {
            self.add(item);
        });

        self.videoGallery = new VideoGalleryViewModel(items, self.parentCommentModel.id());
    }

    BAT_WEBSERVICES_PUSHER.bind(true, 'gallery-remove-videos', function(data) {
        if(data.videos) {
            data.videos.forEach(function(videoIdentifier) {
                self.items.remove(function(item) {
                    return item.identifier === videoIdentifier;
                })
            });
        }
    });

    BAT_WEBSERVICES_PUSHER.bind(true, 'video-transcoded', function(data) {
        handleVideoChange(data.video_data);
    });
};

})(jQuery);
;
(function($) {
    SEARCH_RESULTS_INTERACTION_STATE = {
        NONE: 1,
        HOVER_INTERACTION: 2,
        KEYBOARD_INTERACTION: 3,
    };

    var SearchBarViewModel = function(params) {
        var self = this;

        self.location = params.location;
        self.placeholder = params.placeholder || '';
        self.searchValue = ko.observable(params.searchValue || '');
        self.resultData = ko.observableArray([]);
        self.latestSearchRequestId = 0;

        // Search rate limiting
        self.searchValueDebounced = ko.observable(self.searchValue());

        var searchValueDebouncer = lodash.debounce(function(searchValue) {
            self.searchValueDebounced(searchValue);
        }, BAT_MODEL_SEARCH_BAR.debounceSearchMs);

        self.searchValue.subscribe(function(searchValue) {
            if (searchValue.length < BAT_MODEL_SEARCH_BAR.minCharsDefault) {
                // Clear short queries immediately instead of waiting for the debounce.
                searchValueDebouncer.cancel();
                self.searchValueDebounced(searchValue);
                return;
            }

            searchValueDebouncer(searchValue);
        });

        self.searchValueDebounced.subscribe(function(searchValue) {
            self.getResultData(searchValue);
        });

        // Mouse and keyboard interaction
        self.activeResultIndex = ko.observable(false);
        self.isHoveringSearchResults = ko.observable(false);
        self.isInputFocused = ko.observable(false);
        self.searchResultInteractionState = ko.observable(SEARCH_RESULTS_INTERACTION_STATE.NONE);

        self.isInputFocused.subscribe(function(isFocused) {
            if(!isFocused && self.searchResultInteractionState() === SEARCH_RESULTS_INTERACTION_STATE.KEYBOARD_INTERACTION) {
                self.searchResultInteractionState(SEARCH_RESULTS_INTERACTION_STATE.NONE);
            }
        });

        self.isHoveringSearchResults.subscribe(function(isHovering) {
            if(isHovering) {
                self.searchResultInteractionState(SEARCH_RESULTS_INTERACTION_STATE.HOVER_INTERACTION)
            } else {
                self.searchResultInteractionState(SEARCH_RESULTS_INTERACTION_STATE.NONE)
            }
        });

        self.handleResultMouseOver = function(index, resultItem) {
            self.activeResultIndex(index);
        };

        self.handleKeydown = function(data, event) {
            var activeResultIndex = self.activeResultIndex(),
                isInteractingWithKeyboard = false;

            if (event.key === 'ArrowUp' || event.keyCode === 38) {
                var isResultsAbove = self.isResultsVisible() && activeResultIndex >= 0;
                if (isResultsAbove) {
                    self.activeResultIndex(activeResultIndex === 0 ? false : activeResultIndex - 1);
                    isInteractingWithKeyboard = true;
                }
            } else if (event.key === 'ArrowDown' || event.keyCode === 40) {
                var isResultsBelow = self.isResultsVisible() && activeResultIndex < (self.visibleResults().length - 1);
                if (isResultsBelow) {
                    self.activeResultIndex(activeResultIndex === false ? 0 : activeResultIndex + 1);
                    isInteractingWithKeyboard = true;
                }
            } else if ('Enter' === event.key || 13 === event.keyCode) {
                var isResultSelected = self.isResultsVisible() && activeResultIndex !== false && self.visibleResults().length > activeResultIndex;
                if (isResultSelected && self.searchResultInteractionState() === SEARCH_RESULTS_INTERACTION_STATE.KEYBOARD_INTERACTION) {
                    self.$element.find('.search-bar-link').get(activeResultIndex).click();
                    isInteractingWithKeyboard = true;
                }
            }

            if(isInteractingWithKeyboard) {
                self.searchResultInteractionState(SEARCH_RESULTS_INTERACTION_STATE.KEYBOARD_INTERACTION)

                // Prevent default action
                return false;
            }

            return true;
        };

        // Search results visibility
        self.isResultsVisible = ko.pureComputed(function() {
            var isInteractingWithResults = self.searchResultInteractionState() !== SEARCH_RESULTS_INTERACTION_STATE.NONE;

            return self.resultData().length > 0 && self.searchValue().length > 0 && (self.isInputFocused() || isInteractingWithResults);
        });

        // Search result data
        self.getResultData = function(searchValue) {
            var currentSearchRequestId = ++self.latestSearchRequestId;

            if (searchValue === undefined || searchValue.length < BAT_MODEL_SEARCH_BAR.minCharsDefault) {
                self.resultData.removeAll();
                self.activeResultIndex(false);
                return;
            }

            $.ajax({
                url: BAT_MODEL_SEARCH_BAR.urlApiAutocomplete,
                data: {
                    term: searchValue
                },
                headers: BAT_MODEL_SEARCH_BAR.restNonce ? { 'X-WP-Nonce': BAT_MODEL_SEARCH_BAR.restNonce } : false,
            }).done(function(data) {
                if (currentSearchRequestId !== self.latestSearchRequestId || self.searchValue() !== searchValue) {
                    // Drop out-of-order or stale responses if the input has already changed.
                    return;
                }

                var previousActiveResult = false;
                if (self.activeResultIndex() !== false && self.activeResultIndex() < self.resultData().length) {
                    previousActiveResult = self.resultData()[self.activeResultIndex()];
                }

                var originalResultDataLength = self.resultData().length;

                data.results.forEach(function(result) {
                    self.resultData.push(result);
                });

                self.resultData.splice(0, originalResultDataLength);

                var currentActiveResult = self.resultData().length > self.activeResultIndex() ? self.resultData()[self.activeResultIndex()] : false;

                if (!(currentActiveResult && previousActiveResult.title === currentActiveResult.title)) {
                    self.activeResultIndex(false);
                }
            });
        };

        self.visibleResults = ko.pureComputed(function() {
            // Add "View all" option when results are present
            var results = self.resultData().slice();

            if(results.length > 0) {
                results.push({
                    isViewAll: true,
                    title: BAT_MODEL_SEARCH_BAR.textViewAll,
                    url: BAT_MODEL_SEARCH_BAR.urlSearchViewAll + '&s=' + self.searchValue(),
                });
            }

            return results;
        });

        self.openResult = function(index, resultItem) {
            if(!resultItem.isViewAll) {
                self.searchValue(resultItem.title);
            }

            self.isInputFocused(false);
            self.searchResultInteractionState(SEARCH_RESULTS_INTERACTION_STATE.NONE);
            self.activeResultIndex(index);

            return true;
        };

        // Run initial result request if search bar was pre-filled
        if(self.searchValue()) {
            self.getResultData(self.searchValue());
        }
    };

    SearchBarViewModel.prototype.koDescendantsComplete = function (node) {
        var self = this;

        self.$element = $(node);
    };

    ko.components.register('bat-search-bar', {
        template: { element: 'tmpl-search-bar' },
        viewModel: SearchBarViewModel,
    });

    $(document).ready(function() {
        var searchBars = document.querySelectorAll('bat-search-bar');

        for(var i = 0; i < searchBars.length; i++) {
            var searchBar = searchBars[i];

            ko.applyBindings({}, searchBar);
        }
    });

    ko.bindingHandlers.isHovering = {
        init: function(element, valueAccessor) {
            var $element = $(element),
                isHoveringValue = valueAccessor();

            // Handle mouse interactions
            $element.on('mouseenter', function(event) {
                isHoveringValue(true);
            }).on('mouseleave', function(event) {
                isHoveringValue(false);
            });

            $element.on('touchstart', function(event) {
                isHoveringValue(true);
            }).on('touchend', function(event) {
                // Add delay to touchend processing to allow click events to fire before clicked area is hidden
                setTimeout(function() {
                    isHoveringValue(false);
                }, 500);
            });
        },
    };
})(jQuery);
;
var GalleryViewModel = function(items, limit, limitMobile, shown) {
    var self = this;

    limit = BaT_Theme.screenWidthBreakpoint >= window.innerWidth && 0 < limitMobile ? limitMobile : limit;

    self.items         = ko.observableArray();
    self.limit         = ko.observable(limit);
    self.shown         = ko.observable(shown);
    self.loadingImages = ko.observable(false);

    // Computed
    self.moreText = ko.computed(function() {
        return '+' + (self.items().length - self.limit() + 1).toString();
    });

    self.visible = ko.computed(function() {
        if(self.shown()) {
            return self.items();
        } else {
            return self.items.slice(0, self.limit());
        }
    }).extend({ rateLimit: 10 });

    self.isLastItem = function(item) {
        return ko.computed(function() {
            if(self.shown() || self.visible().length === self.items().length) {
                return false;
            } else {
                var visible = self.visible();

                return visible.length && item === visible[visible.length - 1];
            }
        }).extend({ rateLimit: 50 });
    };

    // Actions
    self.add = function(item) {
        self.items.push(new GalleryItemViewModel(item, self));
    };

    self.remove = function(item) {
        self.items.remove(item);
    };

    self.removeIds = function(ids) {
        self.items.removeAll(self.items().filter(function(item) {
            return -1 !== ids.indexOf(item.id);
        }));
    };

    self.show = function() {
        self.shown(true);
    };

    self.photoSwipe = function(item) {
        var element = getPhotoSwipeElement(),
            items = getPhotoSwipeItems(),
            options = getPhotoSwipeOptions(self.items.indexOf(item)),
            photoSwipe = new PhotoSwipe(element, PhotoSwipeUI_BaT, items, options);

        photoSwipe.init();

        // If the limit is reached while paginating items then show all images in the gallery
        photoSwipe.listen('beforeChange', function () {
            if(false === self.shown() && (photoSwipe.getCurrentIndex() + 1) >= self.limit()) {
                self.shown(true);
            }
        })

        // Remove the element so the document is not polluted
        photoSwipe.listen('destroy', function () {
            element.parentNode.remove();
        });
    }

    function loadAjaxImages(itemsUrl) {
        self.loadingImages(true);

        var loadDelayMs = Math.floor(Math.random() * 8 * 1000); /* 0 - 8 seconds */

        setTimeout(function () {
            jQuery.ajax({
                type: 'GET',
                url: itemsUrl,
                success: function (data) {
                    data.images.forEach(function(item) {
                        self.add(item);
                    });

                    self.loadingImages(false);
                },
            });
        }, loadDelayMs);
    }

    if (typeof items === 'string') {
        loadAjaxImages(items);
    } else {
        items.forEach(function(item) {
            self.add(item);
        });
    }

    function getPhotoSwipeElement() {
        var element = document.querySelector('.pswp');

        if(null === element) {
            elementContainer = document.createElement('div');

            // phpcs:ignore WordPressVIPMinimum.JS.InnerHTML.Found -- HTML is properly escaped.
            elementContainer.innerHTML = BaT_Theme.photoSwipeHtml;

            document.querySelector('body').appendChild(elementContainer);

            element = document.querySelector('.pswp');
        }

        return element;
    }

    function getPhotoSwipeItems() {
        return self.items().map(function(item) {
            return {
                // Identifier
                id: item.id,

                // Voting
                voted: false,
                votes: [],

                // URLs
                msrc: item.images.small.url,
                src: item.images.large.url,

                // Dimensions
                h: item.images.large.height,
                w: item.images.large.width
            };
        })
    }

    function getPhotoSwipeOptions(index) {
        return {
            index: index,
            preload: [1, 2],
            history: false,
            clickToAdvanceImage: true,
            shareButtons: [
                { id: 'facebook', label: BaT_Theme.shareLinkFacebookText, url: BaT_Theme.shareLinkFacebook },
                { id: 'reddit', label: BaT_Theme.shareLinkRedditText, url: BaT_Theme.shareLinkReddit },
                { id: 'twitter', label: BaT_Theme.shareLinkTwitterText, url: BaT_Theme.shareLinkTwitter },
                { id: 'email', label: BaT_Theme.shareLinkEmailText, url: BaT_Theme.shareLinkEmail },
                { id: 'download', label: BaT_Theme.shareLinkSaveText, url: '{{raw_image_url}}', download: true }
            ],
        };
    }
};
;
var GalleryItemViewModel = function(item, gallery) {
    var self = this;

    // Normalize the parameter passed to the constructor
    item = item || {};

    self.id = item.id;

    GalleryItemViewModel.count = (GalleryItemViewModel.count || 0) + 1;

    self.title = !!item.title ? item.title : BaT_Theme.textGalleryListingPhoto + ' ' + self.id.toString();

    self.images = {
        small: {
            height: item.small.height,
            width: item.small.width,
            url: item.small.url,
        },

        large: {
            height: item.large.height,
            width: item.large.width,
            url: item.large.url,
        },

        post: {
            title: `${BaT_Theme.textGalleryLoadLarger} ${self.title} ${GalleryItemViewModel.count}`,
        }
    };

    self.isLastItem = gallery.isLastItem(self);
};
;
var ListingCardViewModel = function (item, parentViewModel) {
    var self = this;

    self.id = item.id;
    self.active = item.active;
    self.categories = item.categories;
    self.country = item.country;
    self.country_code = item.country_code;
    self.countryCodeAlpha3 = ko.observable(item.country_code_alpha3);
    self.countryFlag = item.country_flag;
    self.currency = item.currency;
    self.currentBid = ko.observable(item.current_bid);
    self.currentBidFormatted = ko.observable(item.current_bid_formatted);
    self.currentBidLabel = ko.observable(item.current_bid_label);
    self.initialCurrentBid = item.current_bid;
    self.distance = ko.observable(null);
    self.distanceText = ko.observable('');
    self.distanceFrom = ko.observable('');
    self.excerpt = item.excerpt;
    self.era = item.era;
    self.inSubscription = item.in_subscription;
    self.lat = item.lat;
    self.lon = item.lon;
    self.noreserve = item.noreserve;
    self.pusher = item.pusher;
    self.premium = item.premium;
    self.processingType = item.processing_type;
    self.repeat = item.repeat;
    self.searchable = item.searchable;
    self.soldText = item.sold_text;
    self.soldTextTimestamp = item.sold_text_timestamp;
    self.showLive = item.show_live;
    self.showStats = item.show_stats;
    self.timestampEnd = ko.observable(item.timestamp_end);
    self.initialTimestampEnd = item.timestamp_end;
    self.title = item.title;
    self.thumbnailUrl = item.thumbnail_url;
    self.url = item.url;
    self.watchUrl = item.watch_url;
    self.watched = ko.observable(item.watched);
    self.comments = item.comments;
    self.views = item.views;
    self.watchers = item.watchers;
    self.year = item.year;

    self.isVisible = ko.pureComputed(function () {
        if ('undefined' !== typeof(parentViewModel) && 'active' === parentViewModel.itemsVisible) {
            return 0 < self.secondsToEnd();
        }

        return true;
    });

    self.isInternational = ko.pureComputed(function () {
        return self.countryCodeAlpha3() === 'international';
    });

    self.showDistance = ko.pureComputed(function () {
        return 'undefined' !== typeof(parentViewModel) && parentViewModel.showDistances();
    });

    self.secondsToEnd = ko.pureComputed(function () {
        if ('undefined' !== typeof(parentViewModel) && parentViewModel.currentTimestamp()) {
            //just subscribe to the timer in parentViewModel
        }

        if (!self.active) {
            return 0;
        }

        return Math.max(0, self.timestampEnd() - Math.floor((new Date()).getTime() / 1000));
    });

    self.countdownText = ko.pureComputed(function () {
        return BaT_Theme.formatCountdown(self.secondsToEnd());
    });

    self.soldTextLocalized = ko.pureComputed(function () {
        if (!self.soldText || !self.soldTextTimestamp) {
            return self.soldText;
        }

        // Only localize if moment is available and locale is set
        if (typeof moment === 'undefined' || !BaT_Theme.locale) {
            return self.soldText;
        }

        // Localize the date using moment.js
        var localizedDate = moment.unix(self.soldTextTimestamp).format('L');

        // Replace the date in the sold text (match date pattern in any language)
        return self.soldText.replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/, localizedDate);
    });

    var syncTimeout = null;

    self.toggleListingWatch = function () {
        if ('no' === BaT_Theme.loggedIn) {
            document.location.href = self.watchUrl;
            return;
        }

        clearTimeout(syncTimeout);

        var watched = self.watched();

        self.watched(!watched);

        if (!watched && 'function' === typeof BaT_Theme.trackAddToWatchlist) {
            BaT_Theme.trackAddToWatchlist({
                listingId: self.id,
                watchUrl: self.watchUrl
            });
        }

        syncTimeout = setTimeout(function () {
            jQuery.post(
                self.watchUrl,
                {ajax: true,
                watch: watched ? 'no' : 'yes'}
            );
        }, 750);
    }
};
;
/*! URI.js v1.19.1 http://medialize.github.io/URI.js/ */
/* build contains: URI.js, URI.fragmentQuery.js */
/*
 URI.js - Mutating URLs

 Version: 1.19.1

 Author: Rodney Rehm
 Web: http://medialize.github.io/URI.js/

 Licensed under
   MIT License http://www.opensource.org/licenses/mit-license

*/
(function(k,h){"object"===typeof module&&module.exports?module.exports=h(require("./punycode"),require("./IPv6"),require("./SecondLevelDomains")):"function"===typeof define&&define.amd?define(["./punycode","./IPv6","./SecondLevelDomains"],h):k.URI=h(k.punycode,k.IPv6,k.SecondLevelDomains,k)})(this,function(k,h,r,m){function d(a,b){var c=1<=arguments.length,e=2<=arguments.length;if(!(this instanceof d))return c?e?new d(a,b):new d(a):new d;if(void 0===a){if(c)throw new TypeError("undefined is not a valid argument for URI");
a="undefined"!==typeof location?location.href+"":""}if(null===a&&c)throw new TypeError("null is not a valid argument for URI");this.href(a);return void 0!==b?this.absoluteTo(b):this}function p(a){return a.replace(/([.*+?^=!:${}()|[\]\/\\])/g,"\\$1")}function n(a){return void 0===a?"Undefined":String(Object.prototype.toString.call(a)).slice(8,-1)}function l(a){return"Array"===n(a)}function u(a,b){var c={},d;if("RegExp"===n(b))c=null;else if(l(b)){var f=0;for(d=b.length;f<d;f++)c[b[f]]=!0}else c[b]=
!0;f=0;for(d=a.length;f<d;f++)if(c&&void 0!==c[a[f]]||!c&&b.test(a[f]))a.splice(f,1),d--,f--;return a}function v(a,b){var c;if(l(b)){var d=0;for(c=b.length;d<c;d++)if(!v(a,b[d]))return!1;return!0}var f=n(b);d=0;for(c=a.length;d<c;d++)if("RegExp"===f){if("string"===typeof a[d]&&a[d].match(b))return!0}else if(a[d]===b)return!0;return!1}function B(a,b){if(!l(a)||!l(b)||a.length!==b.length)return!1;a.sort();b.sort();for(var c=0,d=a.length;c<d;c++)if(a[c]!==b[c])return!1;return!0}function y(a){return a.replace(/^\/+|\/+$/g,
"")}function D(a){return escape(a)}function z(a){return encodeURIComponent(a).replace(/[!'()*]/g,D).replace(/\*/g,"%2A")}function w(a){return function(b,c){if(void 0===b)return this._parts[a]||"";this._parts[a]=b||null;this.build(!c);return this}}function C(a,b){return function(c,d){if(void 0===c)return this._parts[a]||"";null!==c&&(c+="",c.charAt(0)===b&&(c=c.substring(1)));this._parts[a]=c;this.build(!d);return this}}var E=m&&m.URI;d.version="1.19.1";var g=d.prototype,q=Object.prototype.hasOwnProperty;
d._parts=function(){return{protocol:null,username:null,password:null,hostname:null,urn:null,port:null,path:null,query:null,fragment:null,preventInvalidHostname:d.preventInvalidHostname,duplicateQueryParameters:d.duplicateQueryParameters,escapeQuerySpace:d.escapeQuerySpace}};d.preventInvalidHostname=!1;d.duplicateQueryParameters=!1;d.escapeQuerySpace=!0;d.protocol_expression=/^[a-z][a-z0-9.+-]*$/i;d.idn_expression=/[^a-z0-9\._-]/i;d.punycode_expression=/(xn--)/i;d.ip4_expression=/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
d.ip6_expression=/^\s*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))(%.+)?\s*$/;
d.find_uri_expression=/\b((?:[a-z][\w-]+:(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+|\(([^\s()<>]+|(\([^\s()<>]+\)))*\))+(?:\(([^\s()<>]+|(\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?\u00ab\u00bb\u201c\u201d\u2018\u2019]))/ig;d.findUri={start:/\b(?:([a-z][a-z0-9.+-]*:\/\/)|www\.)/gi,end:/[\s\r\n]|$/,trim:/[`!()\[\]{};:'".,<>?\u00ab\u00bb\u201c\u201d\u201e\u2018\u2019]+$/,parens:/(\([^\)]*\)|\[[^\]]*\]|\{[^}]*\}|<[^>]*>)/g};d.defaultPorts={http:"80",https:"443",ftp:"21",
gopher:"70",ws:"80",wss:"443"};d.hostProtocols=["http","https"];d.invalid_hostname_characters=/[^a-zA-Z0-9\.\-:_]/;d.domAttributes={a:"href",blockquote:"cite",link:"href",base:"href",script:"src",form:"action",img:"src",area:"href",iframe:"src",embed:"src",source:"src",track:"src",input:"src",audio:"src",video:"src"};d.getDomAttribute=function(a){if(a&&a.nodeName){var b=a.nodeName.toLowerCase();if("input"!==b||"image"===a.type)return d.domAttributes[b]}};d.encode=z;d.decode=decodeURIComponent;d.iso8859=
function(){d.encode=escape;d.decode=unescape};d.unicode=function(){d.encode=z;d.decode=decodeURIComponent};d.characters={pathname:{encode:{expression:/%(24|26|2B|2C|3B|3D|3A|40)/ig,map:{"%24":"$","%26":"&","%2B":"+","%2C":",","%3B":";","%3D":"=","%3A":":","%40":"@"}},decode:{expression:/[\/\?#]/g,map:{"/":"%2F","?":"%3F","#":"%23"}}},reserved:{encode:{expression:/%(21|23|24|26|27|28|29|2A|2B|2C|2F|3A|3B|3D|3F|40|5B|5D)/ig,map:{"%3A":":","%2F":"/","%3F":"?","%23":"#","%5B":"[","%5D":"]","%40":"@",
"%21":"!","%24":"$","%26":"&","%27":"'","%28":"(","%29":")","%2A":"*","%2B":"+","%2C":",","%3B":";","%3D":"="}}},urnpath:{encode:{expression:/%(21|24|27|28|29|2A|2B|2C|3B|3D|40)/ig,map:{"%21":"!","%24":"$","%27":"'","%28":"(","%29":")","%2A":"*","%2B":"+","%2C":",","%3B":";","%3D":"=","%40":"@"}},decode:{expression:/[\/\?#:]/g,map:{"/":"%2F","?":"%3F","#":"%23",":":"%3A"}}}};d.encodeQuery=function(a,b){var c=d.encode(a+"");void 0===b&&(b=d.escapeQuerySpace);return b?c.replace(/%20/g,"+"):c};d.decodeQuery=
function(a,b){a+="";void 0===b&&(b=d.escapeQuerySpace);try{return d.decode(b?a.replace(/\+/g,"%20"):a)}catch(c){return a}};var t={encode:"encode",decode:"decode"},x,A=function(a,b){return function(c){try{return d[b](c+"").replace(d.characters[a][b].expression,function(c){return d.characters[a][b].map[c]})}catch(e){return c}}};for(x in t)d[x+"PathSegment"]=A("pathname",t[x]),d[x+"UrnPathSegment"]=A("urnpath",t[x]);t=function(a,b,c){return function(e){var f=c?function(a){return d[b](d[c](a))}:d[b];
e=(e+"").split(a);for(var g=0,k=e.length;g<k;g++)e[g]=f(e[g]);return e.join(a)}};d.decodePath=t("/","decodePathSegment");d.decodeUrnPath=t(":","decodeUrnPathSegment");d.recodePath=t("/","encodePathSegment","decode");d.recodeUrnPath=t(":","encodeUrnPathSegment","decode");d.encodeReserved=A("reserved","encode");d.parse=function(a,b){b||(b={preventInvalidHostname:d.preventInvalidHostname});var c=a.indexOf("#");-1<c&&(b.fragment=a.substring(c+1)||null,a=a.substring(0,c));c=a.indexOf("?");-1<c&&(b.query=
a.substring(c+1)||null,a=a.substring(0,c));"//"===a.substring(0,2)?(b.protocol=null,a=a.substring(2),a=d.parseAuthority(a,b)):(c=a.indexOf(":"),-1<c&&(b.protocol=a.substring(0,c)||null,b.protocol&&!b.protocol.match(d.protocol_expression)?b.protocol=void 0:"//"===a.substring(c+1,c+3)?(a=a.substring(c+3),a=d.parseAuthority(a,b)):(a=a.substring(c+1),b.urn=!0)));b.path=a;return b};d.parseHost=function(a,b){a||(a="");a=a.replace(/\\/g,"/");var c=a.indexOf("/");-1===c&&(c=a.length);if("["===a.charAt(0)){var e=
a.indexOf("]");b.hostname=a.substring(1,e)||null;b.port=a.substring(e+2,c)||null;"/"===b.port&&(b.port=null)}else{var f=a.indexOf(":");e=a.indexOf("/");f=a.indexOf(":",f+1);-1!==f&&(-1===e||f<e)?(b.hostname=a.substring(0,c)||null,b.port=null):(e=a.substring(0,c).split(":"),b.hostname=e[0]||null,b.port=e[1]||null)}b.hostname&&"/"!==a.substring(c).charAt(0)&&(c++,a="/"+a);b.preventInvalidHostname&&d.ensureValidHostname(b.hostname,b.protocol);b.port&&d.ensureValidPort(b.port);return a.substring(c)||
"/"};d.parseAuthority=function(a,b){a=d.parseUserinfo(a,b);return d.parseHost(a,b)};d.parseUserinfo=function(a,b){var c=a.indexOf("/"),e=a.lastIndexOf("@",-1<c?c:a.length-1);-1<e&&(-1===c||e<c)?(c=a.substring(0,e).split(":"),b.username=c[0]?d.decode(c[0]):null,c.shift(),b.password=c[0]?d.decode(c.join(":")):null,a=a.substring(e+1)):(b.username=null,b.password=null);return a};d.parseQuery=function(a,b){if(!a)return{};a=a.replace(/&+/g,"&").replace(/^\?*&*|&+$/g,"");if(!a)return{};for(var c={},e=a.split("&"),
f=e.length,g,k,l=0;l<f;l++)if(g=e[l].split("="),k=d.decodeQuery(g.shift(),b),g=g.length?d.decodeQuery(g.join("="),b):null,q.call(c,k)){if("string"===typeof c[k]||null===c[k])c[k]=[c[k]];c[k].push(g)}else c[k]=g;return c};d.build=function(a){var b="";a.protocol&&(b+=a.protocol+":");a.urn||!b&&!a.hostname||(b+="//");b+=d.buildAuthority(a)||"";"string"===typeof a.path&&("/"!==a.path.charAt(0)&&"string"===typeof a.hostname&&(b+="/"),b+=a.path);"string"===typeof a.query&&a.query&&(b+="?"+a.query);"string"===
typeof a.fragment&&a.fragment&&(b+="#"+a.fragment);return b};d.buildHost=function(a){var b="";if(a.hostname)b=d.ip6_expression.test(a.hostname)?b+("["+a.hostname+"]"):b+a.hostname;else return"";a.port&&(b+=":"+a.port);return b};d.buildAuthority=function(a){return d.buildUserinfo(a)+d.buildHost(a)};d.buildUserinfo=function(a){var b="";a.username&&(b+=d.encode(a.username));a.password&&(b+=":"+d.encode(a.password));b&&(b+="@");return b};d.buildQuery=function(a,b,c){var e="",f,g;for(f in a)if(q.call(a,
f)&&f)if(l(a[f])){var k={};var h=0;for(g=a[f].length;h<g;h++)void 0!==a[f][h]&&void 0===k[a[f][h]+""]&&(e+="&"+d.buildQueryParameter(f,a[f][h],c),!0!==b&&(k[a[f][h]+""]=!0))}else void 0!==a[f]&&(e+="&"+d.buildQueryParameter(f,a[f],c));return e.substring(1)};d.buildQueryParameter=function(a,b,c){return d.encodeQuery(a,c)+(null!==b?"="+d.encodeQuery(b,c):"")};d.addQuery=function(a,b,c){if("object"===typeof b)for(var e in b)q.call(b,e)&&d.addQuery(a,e,b[e]);else if("string"===typeof b)void 0===a[b]?
a[b]=c:("string"===typeof a[b]&&(a[b]=[a[b]]),l(c)||(c=[c]),a[b]=(a[b]||[]).concat(c));else throw new TypeError("URI.addQuery() accepts an object, string as the name parameter");};d.setQuery=function(a,b,c){if("object"===typeof b)for(var e in b)q.call(b,e)&&d.setQuery(a,e,b[e]);else if("string"===typeof b)a[b]=void 0===c?null:c;else throw new TypeError("URI.setQuery() accepts an object, string as the name parameter");};d.removeQuery=function(a,b,c){var e;if(l(b))for(c=0,e=b.length;c<e;c++)a[b[c]]=
void 0;else if("RegExp"===n(b))for(e in a)b.test(e)&&(a[e]=void 0);else if("object"===typeof b)for(e in b)q.call(b,e)&&d.removeQuery(a,e,b[e]);else if("string"===typeof b)void 0!==c?"RegExp"===n(c)?!l(a[b])&&c.test(a[b])?a[b]=void 0:a[b]=u(a[b],c):a[b]!==String(c)||l(c)&&1!==c.length?l(a[b])&&(a[b]=u(a[b],c)):a[b]=void 0:a[b]=void 0;else throw new TypeError("URI.removeQuery() accepts an object, string, RegExp as the first parameter");};d.hasQuery=function(a,b,c,e){switch(n(b)){case "String":break;
case "RegExp":for(var f in a)if(q.call(a,f)&&b.test(f)&&(void 0===c||d.hasQuery(a,f,c)))return!0;return!1;case "Object":for(var g in b)if(q.call(b,g)&&!d.hasQuery(a,g,b[g]))return!1;return!0;default:throw new TypeError("URI.hasQuery() accepts a string, regular expression or object as the name parameter");}switch(n(c)){case "Undefined":return b in a;case "Boolean":return a=!(l(a[b])?!a[b].length:!a[b]),c===a;case "Function":return!!c(a[b],b,a);case "Array":return l(a[b])?(e?v:B)(a[b],c):!1;case "RegExp":return l(a[b])?
e?v(a[b],c):!1:!(!a[b]||!a[b].match(c));case "Number":c=String(c);case "String":return l(a[b])?e?v(a[b],c):!1:a[b]===c;default:throw new TypeError("URI.hasQuery() accepts undefined, boolean, string, number, RegExp, Function as the value parameter");}};d.joinPaths=function(){for(var a=[],b=[],c=0,e=0;e<arguments.length;e++){var f=new d(arguments[e]);a.push(f);f=f.segment();for(var g=0;g<f.length;g++)"string"===typeof f[g]&&b.push(f[g]),f[g]&&c++}if(!b.length||!c)return new d("");b=(new d("")).segment(b);
""!==a[0].path()&&"/"!==a[0].path().slice(0,1)||b.path("/"+b.path());return b.normalize()};d.commonPath=function(a,b){var c=Math.min(a.length,b.length),d;for(d=0;d<c;d++)if(a.charAt(d)!==b.charAt(d)){d--;break}if(1>d)return a.charAt(0)===b.charAt(0)&&"/"===a.charAt(0)?"/":"";if("/"!==a.charAt(d)||"/"!==b.charAt(d))d=a.substring(0,d).lastIndexOf("/");return a.substring(0,d+1)};d.withinString=function(a,b,c){c||(c={});var e=c.start||d.findUri.start,f=c.end||d.findUri.end,g=c.trim||d.findUri.trim,k=
c.parens||d.findUri.parens,l=/[a-z0-9-]=["']?$/i;for(e.lastIndex=0;;){var h=e.exec(a);if(!h)break;var n=h.index;if(c.ignoreHtml){var p=a.slice(Math.max(n-3,0),n);if(p&&l.test(p))continue}var m=n+a.slice(n).search(f);p=a.slice(n,m);for(m=-1;;){var u=k.exec(p);if(!u)break;m=Math.max(m,u.index+u[0].length)}p=-1<m?p.slice(0,m)+p.slice(m).replace(g,""):p.replace(g,"");p.length<=h[0].length||c.ignore&&c.ignore.test(p)||(m=n+p.length,h=b(p,n,m,a),void 0===h?e.lastIndex=m:(h=String(h),a=a.slice(0,n)+h+a.slice(m),
e.lastIndex=n+h.length))}e.lastIndex=0;return a};d.ensureValidHostname=function(a,b){var c=!!a,e=!1;b&&(e=v(d.hostProtocols,b));if(e&&!c)throw new TypeError("Hostname cannot be empty, if protocol is "+b);if(a&&a.match(d.invalid_hostname_characters)){if(!k)throw new TypeError('Hostname "'+a+'" contains characters other than [A-Z0-9.-:_] and Punycode.js is not available');if(k.toASCII(a).match(d.invalid_hostname_characters))throw new TypeError('Hostname "'+a+'" contains characters other than [A-Z0-9.-:_]');
}};d.ensureValidPort=function(a){if(a){var b=Number(a);if(!(/^[0-9]+$/.test(b)&&0<b&&65536>b))throw new TypeError('Port "'+a+'" is not a valid port');}};d.noConflict=function(a){if(a)return a={URI:this.noConflict()},m.URITemplate&&"function"===typeof m.URITemplate.noConflict&&(a.URITemplate=m.URITemplate.noConflict()),m.IPv6&&"function"===typeof m.IPv6.noConflict&&(a.IPv6=m.IPv6.noConflict()),m.SecondLevelDomains&&"function"===typeof m.SecondLevelDomains.noConflict&&(a.SecondLevelDomains=m.SecondLevelDomains.noConflict()),
a;m.URI===this&&(m.URI=E);return this};g.build=function(a){if(!0===a)this._deferred_build=!0;else if(void 0===a||this._deferred_build)this._string=d.build(this._parts),this._deferred_build=!1;return this};g.clone=function(){return new d(this)};g.valueOf=g.toString=function(){return this.build(!1)._string};g.protocol=w("protocol");g.username=w("username");g.password=w("password");g.hostname=w("hostname");g.port=w("port");g.query=C("query","?");g.fragment=C("fragment","#");g.search=function(a,b){var c=
this.query(a,b);return"string"===typeof c&&c.length?"?"+c:c};g.hash=function(a,b){var c=this.fragment(a,b);return"string"===typeof c&&c.length?"#"+c:c};g.pathname=function(a,b){if(void 0===a||!0===a){var c=this._parts.path||(this._parts.hostname?"/":"");return a?(this._parts.urn?d.decodeUrnPath:d.decodePath)(c):c}this._parts.path=this._parts.urn?a?d.recodeUrnPath(a):"":a?d.recodePath(a):"/";this.build(!b);return this};g.path=g.pathname;g.href=function(a,b){var c;if(void 0===a)return this.toString();
this._string="";this._parts=d._parts();var e=a instanceof d,f="object"===typeof a&&(a.hostname||a.path||a.pathname);a.nodeName&&(f=d.getDomAttribute(a),a=a[f]||"",f=!1);!e&&f&&void 0!==a.pathname&&(a=a.toString());if("string"===typeof a||a instanceof String)this._parts=d.parse(String(a),this._parts);else if(e||f){e=e?a._parts:a;for(c in e)"query"!==c&&q.call(this._parts,c)&&(this._parts[c]=e[c]);e.query&&this.query(e.query,!1)}else throw new TypeError("invalid input");this.build(!b);return this};
g.is=function(a){var b=!1,c=!1,e=!1,f=!1,g=!1,k=!1,h=!1,l=!this._parts.urn;this._parts.hostname&&(l=!1,c=d.ip4_expression.test(this._parts.hostname),e=d.ip6_expression.test(this._parts.hostname),b=c||e,g=(f=!b)&&r&&r.has(this._parts.hostname),k=f&&d.idn_expression.test(this._parts.hostname),h=f&&d.punycode_expression.test(this._parts.hostname));switch(a.toLowerCase()){case "relative":return l;case "absolute":return!l;case "domain":case "name":return f;case "sld":return g;case "ip":return b;case "ip4":case "ipv4":case "inet4":return c;
case "ip6":case "ipv6":case "inet6":return e;case "idn":return k;case "url":return!this._parts.urn;case "urn":return!!this._parts.urn;case "punycode":return h}return null};var F=g.protocol,G=g.port,H=g.hostname;g.protocol=function(a,b){if(a&&(a=a.replace(/:(\/\/)?$/,""),!a.match(d.protocol_expression)))throw new TypeError('Protocol "'+a+"\" contains characters other than [A-Z0-9.+-] or doesn't start with [A-Z]");return F.call(this,a,b)};g.scheme=g.protocol;g.port=function(a,b){if(this._parts.urn)return void 0===
a?"":this;void 0!==a&&(0===a&&(a=null),a&&(a+="",":"===a.charAt(0)&&(a=a.substring(1)),d.ensureValidPort(a)));return G.call(this,a,b)};g.hostname=function(a,b){if(this._parts.urn)return void 0===a?"":this;if(void 0!==a){var c={preventInvalidHostname:this._parts.preventInvalidHostname};if("/"!==d.parseHost(a,c))throw new TypeError('Hostname "'+a+'" contains characters other than [A-Z0-9.-]');a=c.hostname;this._parts.preventInvalidHostname&&d.ensureValidHostname(a,this._parts.protocol)}return H.call(this,
a,b)};g.origin=function(a,b){if(this._parts.urn)return void 0===a?"":this;if(void 0===a){var c=this.protocol();return this.authority()?(c?c+"://":"")+this.authority():""}c=d(a);this.protocol(c.protocol()).authority(c.authority()).build(!b);return this};g.host=function(a,b){if(this._parts.urn)return void 0===a?"":this;if(void 0===a)return this._parts.hostname?d.buildHost(this._parts):"";if("/"!==d.parseHost(a,this._parts))throw new TypeError('Hostname "'+a+'" contains characters other than [A-Z0-9.-]');
this.build(!b);return this};g.authority=function(a,b){if(this._parts.urn)return void 0===a?"":this;if(void 0===a)return this._parts.hostname?d.buildAuthority(this._parts):"";if("/"!==d.parseAuthority(a,this._parts))throw new TypeError('Hostname "'+a+'" contains characters other than [A-Z0-9.-]');this.build(!b);return this};g.userinfo=function(a,b){if(this._parts.urn)return void 0===a?"":this;if(void 0===a){var c=d.buildUserinfo(this._parts);return c?c.substring(0,c.length-1):c}"@"!==a[a.length-1]&&
(a+="@");d.parseUserinfo(a,this._parts);this.build(!b);return this};g.resource=function(a,b){if(void 0===a)return this.path()+this.search()+this.hash();var c=d.parse(a);this._parts.path=c.path;this._parts.query=c.query;this._parts.fragment=c.fragment;this.build(!b);return this};g.subdomain=function(a,b){if(this._parts.urn)return void 0===a?"":this;if(void 0===a){if(!this._parts.hostname||this.is("IP"))return"";var c=this._parts.hostname.length-this.domain().length-1;return this._parts.hostname.substring(0,
c)||""}c=this._parts.hostname.length-this.domain().length;c=this._parts.hostname.substring(0,c);c=new RegExp("^"+p(c));a&&"."!==a.charAt(a.length-1)&&(a+=".");if(-1!==a.indexOf(":"))throw new TypeError("Domains cannot contain colons");a&&d.ensureValidHostname(a,this._parts.protocol);this._parts.hostname=this._parts.hostname.replace(c,a);this.build(!b);return this};g.domain=function(a,b){if(this._parts.urn)return void 0===a?"":this;"boolean"===typeof a&&(b=a,a=void 0);if(void 0===a){if(!this._parts.hostname||
this.is("IP"))return"";var c=this._parts.hostname.match(/\./g);if(c&&2>c.length)return this._parts.hostname;c=this._parts.hostname.length-this.tld(b).length-1;c=this._parts.hostname.lastIndexOf(".",c-1)+1;return this._parts.hostname.substring(c)||""}if(!a)throw new TypeError("cannot set domain empty");if(-1!==a.indexOf(":"))throw new TypeError("Domains cannot contain colons");d.ensureValidHostname(a,this._parts.protocol);!this._parts.hostname||this.is("IP")?this._parts.hostname=a:(c=new RegExp(p(this.domain())+
"$"),this._parts.hostname=this._parts.hostname.replace(c,a));this.build(!b);return this};g.tld=function(a,b){if(this._parts.urn)return void 0===a?"":this;"boolean"===typeof a&&(b=a,a=void 0);if(void 0===a){if(!this._parts.hostname||this.is("IP"))return"";var c=this._parts.hostname.lastIndexOf(".");c=this._parts.hostname.substring(c+1);return!0!==b&&r&&r.list[c.toLowerCase()]?r.get(this._parts.hostname)||c:c}if(a)if(a.match(/[^a-zA-Z0-9-]/))if(r&&r.is(a))c=new RegExp(p(this.tld())+"$"),this._parts.hostname=
this._parts.hostname.replace(c,a);else throw new TypeError('TLD "'+a+'" contains characters other than [A-Z0-9]');else{if(!this._parts.hostname||this.is("IP"))throw new ReferenceError("cannot set TLD on non-domain host");c=new RegExp(p(this.tld())+"$");this._parts.hostname=this._parts.hostname.replace(c,a)}else throw new TypeError("cannot set TLD empty");this.build(!b);return this};g.directory=function(a,b){if(this._parts.urn)return void 0===a?"":this;if(void 0===a||!0===a){if(!this._parts.path&&
!this._parts.hostname)return"";if("/"===this._parts.path)return"/";var c=this._parts.path.length-this.filename().length-1;c=this._parts.path.substring(0,c)||(this._parts.hostname?"/":"");return a?d.decodePath(c):c}c=this._parts.path.length-this.filename().length;c=this._parts.path.substring(0,c);c=new RegExp("^"+p(c));this.is("relative")||(a||(a="/"),"/"!==a.charAt(0)&&(a="/"+a));a&&"/"!==a.charAt(a.length-1)&&(a+="/");a=d.recodePath(a);this._parts.path=this._parts.path.replace(c,a);this.build(!b);
return this};g.filename=function(a,b){if(this._parts.urn)return void 0===a?"":this;if("string"!==typeof a){if(!this._parts.path||"/"===this._parts.path)return"";var c=this._parts.path.lastIndexOf("/");c=this._parts.path.substring(c+1);return a?d.decodePathSegment(c):c}c=!1;"/"===a.charAt(0)&&(a=a.substring(1));a.match(/\.?\//)&&(c=!0);var e=new RegExp(p(this.filename())+"$");a=d.recodePath(a);this._parts.path=this._parts.path.replace(e,a);c?this.normalizePath(b):this.build(!b);return this};g.suffix=
function(a,b){if(this._parts.urn)return void 0===a?"":this;if(void 0===a||!0===a){if(!this._parts.path||"/"===this._parts.path)return"";var c=this.filename(),e=c.lastIndexOf(".");if(-1===e)return"";c=c.substring(e+1);c=/^[a-z0-9%]+$/i.test(c)?c:"";return a?d.decodePathSegment(c):c}"."===a.charAt(0)&&(a=a.substring(1));if(c=this.suffix())e=a?new RegExp(p(c)+"$"):new RegExp(p("."+c)+"$");else{if(!a)return this;this._parts.path+="."+d.recodePath(a)}e&&(a=d.recodePath(a),this._parts.path=this._parts.path.replace(e,
a));this.build(!b);return this};g.segment=function(a,b,c){var d=this._parts.urn?":":"/",f=this.path(),g="/"===f.substring(0,1);f=f.split(d);void 0!==a&&"number"!==typeof a&&(c=b,b=a,a=void 0);if(void 0!==a&&"number"!==typeof a)throw Error('Bad segment "'+a+'", must be 0-based integer');g&&f.shift();0>a&&(a=Math.max(f.length+a,0));if(void 0===b)return void 0===a?f:f[a];if(null===a||void 0===f[a])if(l(b)){f=[];a=0;for(var k=b.length;a<k;a++)if(b[a].length||f.length&&f[f.length-1].length)f.length&&!f[f.length-
1].length&&f.pop(),f.push(y(b[a]))}else{if(b||"string"===typeof b)b=y(b),""===f[f.length-1]?f[f.length-1]=b:f.push(b)}else b?f[a]=y(b):f.splice(a,1);g&&f.unshift("");return this.path(f.join(d),c)};g.segmentCoded=function(a,b,c){var e;"number"!==typeof a&&(c=b,b=a,a=void 0);if(void 0===b){a=this.segment(a,b,c);if(l(a)){var f=0;for(e=a.length;f<e;f++)a[f]=d.decode(a[f])}else a=void 0!==a?d.decode(a):void 0;return a}if(l(b))for(f=0,e=b.length;f<e;f++)b[f]=d.encode(b[f]);else b="string"===typeof b||b instanceof
String?d.encode(b):b;return this.segment(a,b,c)};var I=g.query;g.query=function(a,b){if(!0===a)return d.parseQuery(this._parts.query,this._parts.escapeQuerySpace);if("function"===typeof a){var c=d.parseQuery(this._parts.query,this._parts.escapeQuerySpace),e=a.call(this,c);this._parts.query=d.buildQuery(e||c,this._parts.duplicateQueryParameters,this._parts.escapeQuerySpace);this.build(!b);return this}return void 0!==a&&"string"!==typeof a?(this._parts.query=d.buildQuery(a,this._parts.duplicateQueryParameters,
this._parts.escapeQuerySpace),this.build(!b),this):I.call(this,a,b)};g.setQuery=function(a,b,c){var e=d.parseQuery(this._parts.query,this._parts.escapeQuerySpace);if("string"===typeof a||a instanceof String)e[a]=void 0!==b?b:null;else if("object"===typeof a)for(var f in a)q.call(a,f)&&(e[f]=a[f]);else throw new TypeError("URI.addQuery() accepts an object, string as the name parameter");this._parts.query=d.buildQuery(e,this._parts.duplicateQueryParameters,this._parts.escapeQuerySpace);"string"!==typeof a&&
(c=b);this.build(!c);return this};g.addQuery=function(a,b,c){var e=d.parseQuery(this._parts.query,this._parts.escapeQuerySpace);d.addQuery(e,a,void 0===b?null:b);this._parts.query=d.buildQuery(e,this._parts.duplicateQueryParameters,this._parts.escapeQuerySpace);"string"!==typeof a&&(c=b);this.build(!c);return this};g.removeQuery=function(a,b,c){var e=d.parseQuery(this._parts.query,this._parts.escapeQuerySpace);d.removeQuery(e,a,b);this._parts.query=d.buildQuery(e,this._parts.duplicateQueryParameters,
this._parts.escapeQuerySpace);"string"!==typeof a&&(c=b);this.build(!c);return this};g.hasQuery=function(a,b,c){var e=d.parseQuery(this._parts.query,this._parts.escapeQuerySpace);return d.hasQuery(e,a,b,c)};g.setSearch=g.setQuery;g.addSearch=g.addQuery;g.removeSearch=g.removeQuery;g.hasSearch=g.hasQuery;g.normalize=function(){return this._parts.urn?this.normalizeProtocol(!1).normalizePath(!1).normalizeQuery(!1).normalizeFragment(!1).build():this.normalizeProtocol(!1).normalizeHostname(!1).normalizePort(!1).normalizePath(!1).normalizeQuery(!1).normalizeFragment(!1).build()};
g.normalizeProtocol=function(a){"string"===typeof this._parts.protocol&&(this._parts.protocol=this._parts.protocol.toLowerCase(),this.build(!a));return this};g.normalizeHostname=function(a){this._parts.hostname&&(this.is("IDN")&&k?this._parts.hostname=k.toASCII(this._parts.hostname):this.is("IPv6")&&h&&(this._parts.hostname=h.best(this._parts.hostname)),this._parts.hostname=this._parts.hostname.toLowerCase(),this.build(!a));return this};g.normalizePort=function(a){"string"===typeof this._parts.protocol&&
this._parts.port===d.defaultPorts[this._parts.protocol]&&(this._parts.port=null,this.build(!a));return this};g.normalizePath=function(a){var b=this._parts.path;if(!b)return this;if(this._parts.urn)return this._parts.path=d.recodeUrnPath(this._parts.path),this.build(!a),this;if("/"===this._parts.path)return this;b=d.recodePath(b);var c="";if("/"!==b.charAt(0)){var e=!0;b="/"+b}if("/.."===b.slice(-3)||"/."===b.slice(-2))b+="/";b=b.replace(/(\/(\.\/)+)|(\/\.$)/g,"/").replace(/\/{2,}/g,"/");e&&(c=b.substring(1).match(/^(\.\.\/)+/)||
"")&&(c=c[0]);for(;;){var f=b.search(/\/\.\.(\/|$)/);if(-1===f)break;else if(0===f){b=b.substring(3);continue}var g=b.substring(0,f).lastIndexOf("/");-1===g&&(g=f);b=b.substring(0,g)+b.substring(f+3)}e&&this.is("relative")&&(b=c+b.substring(1));this._parts.path=b;this.build(!a);return this};g.normalizePathname=g.normalizePath;g.normalizeQuery=function(a){"string"===typeof this._parts.query&&(this._parts.query.length?this.query(d.parseQuery(this._parts.query,this._parts.escapeQuerySpace)):this._parts.query=
null,this.build(!a));return this};g.normalizeFragment=function(a){this._parts.fragment||(this._parts.fragment=null,this.build(!a));return this};g.normalizeSearch=g.normalizeQuery;g.normalizeHash=g.normalizeFragment;g.iso8859=function(){var a=d.encode,b=d.decode;d.encode=escape;d.decode=decodeURIComponent;try{this.normalize()}finally{d.encode=a,d.decode=b}return this};g.unicode=function(){var a=d.encode,b=d.decode;d.encode=z;d.decode=unescape;try{this.normalize()}finally{d.encode=a,d.decode=b}return this};
g.readable=function(){var a=this.clone();a.username("").password("").normalize();var b="";a._parts.protocol&&(b+=a._parts.protocol+"://");a._parts.hostname&&(a.is("punycode")&&k?(b+=k.toUnicode(a._parts.hostname),a._parts.port&&(b+=":"+a._parts.port)):b+=a.host());a._parts.hostname&&a._parts.path&&"/"!==a._parts.path.charAt(0)&&(b+="/");b+=a.path(!0);if(a._parts.query){for(var c="",e=0,f=a._parts.query.split("&"),g=f.length;e<g;e++){var h=(f[e]||"").split("=");c+="&"+d.decodeQuery(h[0],this._parts.escapeQuerySpace).replace(/&/g,
"%26");void 0!==h[1]&&(c+="="+d.decodeQuery(h[1],this._parts.escapeQuerySpace).replace(/&/g,"%26"))}b+="?"+c.substring(1)}return b+=d.decodeQuery(a.hash(),!0)};g.absoluteTo=function(a){var b=this.clone(),c=["protocol","username","password","hostname","port"],e,f;if(this._parts.urn)throw Error("URNs do not have any generally defined hierarchical components");a instanceof d||(a=new d(a));if(b._parts.protocol)return b;b._parts.protocol=a._parts.protocol;if(this._parts.hostname)return b;for(e=0;f=c[e];e++)b._parts[f]=
a._parts[f];b._parts.path?(".."===b._parts.path.substring(-2)&&(b._parts.path+="/"),"/"!==b.path().charAt(0)&&(c=(c=a.directory())?c:0===a.path().indexOf("/")?"/":"",b._parts.path=(c?c+"/":"")+b._parts.path,b.normalizePath())):(b._parts.path=a._parts.path,b._parts.query||(b._parts.query=a._parts.query));b.build();return b};g.relativeTo=function(a){var b=this.clone().normalize();if(b._parts.urn)throw Error("URNs do not have any generally defined hierarchical components");a=(new d(a)).normalize();var c=
b._parts;var e=a._parts;var f=b.path();a=a.path();if("/"!==f.charAt(0))throw Error("URI is already relative");if("/"!==a.charAt(0))throw Error("Cannot calculate a URI relative to another relative URI");c.protocol===e.protocol&&(c.protocol=null);if(c.username===e.username&&c.password===e.password&&null===c.protocol&&null===c.username&&null===c.password&&c.hostname===e.hostname&&c.port===e.port)c.hostname=null,c.port=null;else return b.build();if(f===a)return c.path="",b.build();f=d.commonPath(f,a);
if(!f)return b.build();e=e.path.substring(f.length).replace(/[^\/]*$/,"").replace(/.*?\//g,"../");c.path=e+c.path.substring(f.length)||"./";return b.build()};g.equals=function(a){var b=this.clone(),c=new d(a);a={};var e;b.normalize();c.normalize();if(b.toString()===c.toString())return!0;var f=b.query();var g=c.query();b.query("");c.query("");if(b.toString()!==c.toString()||f.length!==g.length)return!1;b=d.parseQuery(f,this._parts.escapeQuerySpace);g=d.parseQuery(g,this._parts.escapeQuerySpace);for(e in b)if(q.call(b,
e)){if(!l(b[e])){if(b[e]!==g[e])return!1}else if(!B(b[e],g[e]))return!1;a[e]=!0}for(e in g)if(q.call(g,e)&&!a[e])return!1;return!0};g.preventInvalidHostname=function(a){this._parts.preventInvalidHostname=!!a;return this};g.duplicateQueryParameters=function(a){this._parts.duplicateQueryParameters=!!a;return this};g.escapeQuerySpace=function(a){this._parts.escapeQuerySpace=!!a;return this};return d});
(function(k,h){"object"===typeof module&&module.exports?module.exports=h(require("./URI")):"function"===typeof define&&define.amd?define(["./URI"],h):h(k.URI)})(this,function(k){var h=k.prototype,r=h.fragment;k.fragmentPrefix="?";var m=k._parts;k._parts=function(){var d=m();d.fragmentPrefix=k.fragmentPrefix;return d};h.fragmentPrefix=function(d){this._parts.fragmentPrefix=d;return this};h.fragment=function(d,h){var n=this._parts.fragmentPrefix,l=this._parts.fragment||"";return!0===d?l.substring(0,
n.length)!==n?{}:k.parseQuery(l.substring(n.length)):void 0!==d&&"string"!==typeof d?(this._parts.fragment=n+k.buildQuery(d),this.build(!h),this):r.call(this,d,h)};h.addFragment=function(d,h,n){var l=this._parts.fragmentPrefix,m=k.parseQuery((this._parts.fragment||"").substring(l.length));k.addQuery(m,d,h);this._parts.fragment=l+k.buildQuery(m);"string"!==typeof d&&(n=h);this.build(!n);return this};h.removeFragment=function(d,h,n){var l=this._parts.fragmentPrefix,m=k.parseQuery((this._parts.fragment||
"").substring(l.length));k.removeQuery(m,d,h);this._parts.fragment=l+k.buildQuery(m);"string"!==typeof d&&(n=h);this.build(!n);return this};h.setFragment=function(d,h,m){var l=this._parts.fragmentPrefix,n=k.parseQuery((this._parts.fragment||"").substring(l.length));k.setQuery(n,d,h);this._parts.fragment=l+k.buildQuery(n);"string"!==typeof d&&(m=h);this.build(!m);return this};h.addHash=h.addFragment;h.removeHash=h.removeFragment;h.setHash=h.setFragment;return k});
;
var ListingsToolbarViewModel = function (listingsType) {

    var self = this;

    self.listingsType = listingsType;

    self.listingsNumber = ko.observable(0);

    self.selectedOptionsNumber = ko.observable(0);

    if ('no-reserve' === self.listingsType) {
        self.listingsTypeCaption = BAT_MODEL_LISTINGS_TOOLBAR.captionNoReserveLive;
    } else {
        self.listingsTypeCaption = BAT_MODEL_LISTINGS_TOOLBAR.captionAllLive;
    }

    self.filteredNumber = ko.observable(0);

    self.filteredNumberText = ko.pureComputed(function () {
        return self.filteredNumber().toLocaleString('en-US');
    });

    self.listingsView = ko.observable(BAT_MODEL_LISTINGS_TOOLBAR.listingsView);

    self.listingsView.subscribe(function (value) {
        if ('yes' === BaT_Theme.loggedIn) {
            jQuery.post(
                BaT_Theme.ajaxUrl,
                {
                    action: BAT_MODEL_LISTINGS_TOOLBAR.ajaxActionUserViewToggle,
                    nonce: BAT_MODEL_LISTINGS_TOOLBAR.ajaxActionUserViewToggleNonce,
                    view: value
                }
            );
        }
    });

    self.userLoggedIn = BAT_MODEL_LISTINGS_TOOLBAR.userLoggedIn;

    self.userAdmin = BAT_MODEL_LISTINGS_TOOLBAR.userAdmin;

    self.sortByDefault = 'td';

    const minYear = 1800;
    const maxYear = (new Date()).getFullYear();

    /* Sorting */
    self.sortingOptions = ko.observableArray();

    self.userLocation = ko.observable();

    self.userLocation.subscribe(function () {
        var options = [{ key: 'td', caption: BAT_MODEL_LISTINGS_TOOLBAR.textSortByEndingDESC },
        { key: 'ta', caption: BAT_MODEL_LISTINGS_TOOLBAR.textSortByEndingASC },
        { key: 'ba', caption: BAT_MODEL_LISTINGS_TOOLBAR.textSortByBidASC },
        { key: 'bd', caption: BAT_MODEL_LISTINGS_TOOLBAR.textSortByBidDESC }];

        if (false === self.userLocation()) {
            options.push({ key: 'location-set', caption: BAT_MODEL_LISTINGS_TOOLBAR.textSortByDistanceUndefined });
        } else {
            //phpcs:disable WordPressVIPMinimum.JS.StringConcat.Found
            options.push({ key: 'location', caption: BAT_MODEL_LISTINGS_TOOLBAR.textSortByDistanceDefined + ' <b>' + self.userLocation().zipCode + '</b>' });
            options.push({ key: 'location-set', caption: '<b>' + BAT_MODEL_LISTINGS_TOOLBAR.textSortByChangeZIP + '</b>' });
            //phpcs:enable
        }

        self.sortingOptions(options);
    });

    self.userLocation(BaT_Theme.getUserLocation());

    self.sortBy = ko.observable(self.sortByDefault);

    self.sortByDisplay = ko.pureComputed(function () {
        var sortBy = self.sortBy();
        var sortByDisplay = '-';
        ko.utils.arrayForEach(self.sortingOptions(), function (item) {
            if (sortBy === item.key) {
                sortByDisplay = item.caption;
            }
        });

        return sortByDisplay;
    });

    self.setSortBy = function (key) {
        jQuery('.toolbar-dropdown').removeClass('active');

        if ('location-set' === key) {
            BaT_Theme.promptUserLocation(function () {
                var location = BaT_Theme.getUserLocation();

                if (false !== location) {
                    self.userLocation(location);
                    self.sortBy('location');
                    setTimeout(function () { self.updateUrl(); }, 50); // Updade URL after interaction with the modal form
                }
            }, function () {
                setTimeout(function () { self.updateUrl(); }, 50); // Updade URL after interaction with the modal form
            });

            return;
        }

        self.sortBy(key);
    }

    const isEnterKey = (event) => {
        const keyCode = (event.which ? event.which : event.keyCode);
        return keyCode === 13
    }

    self.onKeypressSortBy = function (event, key) {
        if (isEnterKey(event)) {
            self.setSortBy(key);
        }
    }

    /* Search Term*/
    self.filterTerm = ko.observable('').extend({ throttle: 1000 });

    /* Filter Watched */
    self.filterWatched = ko.observable(false);

    self.toggleFilterWatch = function () {
        self.filterWatched(!self.filterWatched());
    }

    self.onKeypressWatched = function (data, event) {
        if (isEnterKey(event)) {
            self.toggleFilterWatch();
        }
    }

    /* Filter Subsribed */
    self.filterSubscribed = ko.observable(false);

    self.toggleFilterSubscribed = function () {
        self.filterSubscribed(!self.filterSubscribed());
    }

    self.onKeypressSubscribed = function (data, event) {
        if (isEnterKey(event)) {
            self.toggleFilterSubscribed();
        }
    }

    /* Filter Locations */
    self.filterLocationsOptions = ko.observableArray();

    self.filterLocationsOptionsUngrouped = ko.observableArray();

    self.filterLocationsInit = function (locations) {
        ko.utils.arrayForEach(locations, function (location) {
            var countries = ko.observableArray();

            ko.utils.arrayForEach(location.countries, function (country) {
                countries.push({ key: country.id.toString(), caption: country.title, value: ko.observable(false) });
            });

            self.filterLocationsOptions.push({ key: location.id.toString(), caption: location.title, value: ko.observable(false), suboptions: countries });
        });
    }

    self.toggleFilterLocation = function (key, value) {
        ko.utils.arrayForEach(self.filterLocationsOptions(), function (item) {
            var toggleGroup = false;
            var subGroupSelected = 0;

            if (key === item.key) {
                toggleGroup = true;
                value = 'undefined' === typeof value ? !item.value() : value;
                item.value(value);
            }

            if (item.suboptions().length) {
                ko.utils.arrayForEach(item.suboptions(), function (subitem) {
                    if (key === subitem.key || toggleGroup) {
                        value = 'undefined' === typeof value ? !subitem.value() : value;
                        subitem.value(value);
                    }

                    subGroupSelected += subitem.value() ? 1 : 0;
                });
            }

            item.value(subGroupSelected === item.suboptions().length);
        });
    }

    self.onKeypressFliterLocation = function (event, key) {
        if (isEnterKey(event)) {
            self.toggleFilterLocation(key);
        }
    }

    self.filterLocationsSelectedText = ko.observable('');

    self.filterLocations = ko.pureComputed(function () {
        var locations = [];

        ko.utils.arrayForEach(self.filterLocationsOptionsUngrouped(), function (item) {
            if (item.value()) locations.push(item.key);
        });

        return locations;
    }).extend({ throttle: 750 });

    self.filterLocationsSelectedNumber = ko.pureComputed(function () {
        var number = 0;
        var captions = [];

        self.filterLocationsOptionsUngrouped.removeAll();

        ko.utils.arrayForEach(self.filterLocationsOptions(), function (item) {
            if (item.suboptions().length) {
                ko.utils.arrayForEach(item.suboptions(), function (subitem) {
                    if (subitem.value()) {
                        number++;
                        captions.push(subitem.caption);
                        self.filterLocationsOptionsUngrouped.push(subitem);
                    }
                });
            }
        });

        self.filterLocationsSelectedText(captions.join(', '));

        return number;
    });

    /* Filter Listing types */
    let noreserveOptionEnabled = 'no-reserve' !== self.listingsType;

    self.filterTypeOptions = ko.observableArray([
        { key: 'noreserve', caption: BAT_MODEL_LISTINGS_TOOLBAR.textNoReserve, value: ko.observable(false), visible: noreserveOptionEnabled },
        { key: 'premium', caption: BAT_MODEL_LISTINGS_TOOLBAR.textPremium, value: ko.observable(false), visible: true },
        { key: 'repeat', caption: BAT_MODEL_LISTINGS_TOOLBAR.textRepeat, value: ko.observable(false), visible: true }]);

    self.toggleFilterType = function (key, value) {
        ko.utils.arrayForEach(self.filterTypeOptions(), function (item) {
            if (key === item.key && item.visible) {
                item.value('undefined' === typeof value ? !item.value() : value);
            }
        });
    }

    self.onKeypressFliterType = function (event, key) {
        if (isEnterKey(event)) {
            self.toggleFilterType(key);
        }
    }

    self.filterTypeSelectedNumber = ko.pureComputed(function () {
        var number = 0;
        ko.utils.arrayForEach(self.filterTypeOptions(), function (item) {
            number += item.value() ? 1 : 0;
        });
        return number;
    });

    /* Filter Categories */
    self.filterCategoriesOptions = ko.observableArray();

    ko.utils.arrayForEach(BAT_MODEL_LISTINGS_TOOLBAR.categories, function (category) {
        self.filterCategoriesOptions.push({ key: category.id.toString(), caption: category.title, value: ko.observable(false) });
    });

    self.toggleFilterCategory = function (key, value) {
        ko.utils.arrayForEach(self.filterCategoriesOptions(), function (item) {
            if (key === item.key) {
                item.value('undefined' === typeof value ? !item.value() : value);
            }
        });
    }

    self.onKeypressFliterCategory = function (event, key) {
        if (isEnterKey(event)) {
            self.toggleFilterCategory(key);
        }
    }

    self.filterCategoriesSelectedText = ko.observable('');

    self.filterCategories = ko.pureComputed(function () {
        var categories = [];

        ko.utils.arrayForEach(self.filterCategoriesOptions(), function (item) {
            if (item.value()) categories.push(item.key);
        });

        return categories;
    }).extend({ throttle: 750 });

    self.filterCategoriesSelectedNumber = ko.pureComputed(function () {
        var number = 0;
        var captions = [];

        ko.utils.arrayForEach(self.filterCategoriesOptions(), function (item) {
            if (item.value()) {
                number++;
                captions.push(item.caption);
            }
        });

        self.filterCategoriesSelectedText(captions.join(', '));

        return number;
    });

    /* Filter Eras */
    self.filterErasOptions = ko.observableArray();

    ko.utils.arrayForEach(BAT_MODEL_LISTINGS_TOOLBAR.eras, function (era) {
        self.filterErasOptions.push({ key: era.id, caption: era.title, value: ko.observable(false) });
    });

    self.toggleFilterEra = function (key, value) {
        ko.utils.arrayForEach(self.filterErasOptions(), function (item) {
            if (key === item.key) {
                item.value('undefined' === typeof value ? !item.value() : value);
            }
        });
    }

    self.onKeypressFliterEra = function (event, key) {
        if (isEnterKey(event)) {
            self.toggleFilterEra(key);
        }
    }

    self.filterErasSelectedText = ko.observable('');

    self.filterEras = ko.pureComputed(function () {
        var eras = [];

        ko.utils.arrayForEach(self.filterErasOptions(), function (item) {
            if (item.value()) eras.push(item.key);
        });

        return eras;
    }).extend({ throttle: 750 });

    self.filterErasSelectedNumber = ko.pureComputed(function () {
        var number = 0;
        var captions = [];

        ko.utils.arrayForEach(self.filterErasOptions(), function (item) {
            if (item.value()) {
                number++;
                captions.push(item.caption);
            }
        });

        self.filterErasSelectedText(captions.join(', '));

        return number;
    });

    /* Filter Origin */
    self.filterOriginsOptions = ko.observableArray();

    ko.utils.arrayForEach(BAT_MODEL_LISTINGS_TOOLBAR.origins, function (origin) {
        self.filterOriginsOptions.push({ key: origin.id.toString(), caption: origin.title, value: ko.observable(false) });
    });

    self.toggleFilterOrigin = function (key, value) {
        ko.utils.arrayForEach(self.filterOriginsOptions(), function (item) {
            if (key === item.key) {
                item.value('undefined' === typeof value ? !item.value() : value);
            }
        });
    }

    self.onKeypressFliterOrigin = function (event, key) {
        if (isEnterKey(event)) {
            self.toggleFilterOrigin(key);
        }
    }

    self.filterOriginsSelectedText = ko.observable('');

    self.filterOrigins = ko.pureComputed(function () {
        var origins = [];

        ko.utils.arrayForEach(self.filterOriginsOptions(), function (item) {
            if (item.value()) origins.push(item.key);
        });

        return origins;
    }).extend({ throttle: 750 });

    self.filterOriginsSelectedNumber = ko.pureComputed(function () {
        var number = 0;
        var captions = [];

        ko.utils.arrayForEach(self.filterOriginsOptions(), function (item) {
            if (item.value()) {
                number++;
                captions.push(item.caption);
            }
        });

        self.filterOriginsSelectedText(captions.join(', '));

        return number;
    });

    /* Filter Years Range */
    self.filterYearRangeBeg = ko.observable('').extend({ throttle: 1000 });
    self.filterYearRangeEnd = ko.observable('').extend({ throttle: 1000 });

    self.filterYearRangeText = ko.pureComputed(function () {
        var yearBeg = parseInt(self.filterYearRangeBeg());
        var yearEnd = parseInt(self.filterYearRangeEnd());

        if (isNaN(yearBeg) && isNaN(yearEnd)) return '';

        yearBeg = isNaN(yearBeg) ? minYear : yearBeg;
        yearEnd = isNaN(yearEnd) ? maxYear : yearEnd;

        yearBeg = yearBeg > maxYear ? maxYear : yearBeg;
        yearEnd = yearEnd > maxYear ? maxYear : yearEnd;

        return yearBeg.toString() + '-' + yearEnd.toString();
    });

    /* Filter Ends Within */
    self.filterEndingWithinOptions = ko.observableArray();

    self.filterEndingWithinDefault = null;
    self.filterEndingWithinKeys = [];

    ko.utils.arrayForEach(BAT_MODEL_LISTINGS_TOOLBAR.filterEndingOptions, function (option) {
        self.filterEndingWithinOptions.push({ key: option.value, caption: option.text, value: ko.observable(option.default) });
        self.filterEndingWithinKeys.push(option.value);

        if (option.default) {
            self.filterEndingWithinDefault = option.value;
        }
    });

    self.toggleFilterEndingWithin = function (key) {
        if (false === self.filterEndingWithinKeys.includes(key)) {
            key = self.filterEndingWithinDefault;
        }

        ko.utils.arrayForEach(self.filterEndingWithinOptions(), function (item) {
            item.value(key === item.key);
        });
    }

    self.onKeypressFliterEndingWithin = function (event, key) {
        if (isEnterKey(event)) {
            self.toggleFilterEndingWithin(key);
        }
    }

    self.filterEndingWithin = ko.pureComputed(function () {
        var within = 0;

        ko.utils.arrayForEach(self.filterEndingWithinOptions(), function (item) {
            if (item.value() && '' !== item.key) within = item.key;
        });

        return within;
    }).extend({ throttle: 100 });

    self.filterEndingWithinText = ko.pureComputed(function () {
        var text = '';

        ko.utils.arrayForEach(self.filterEndingWithinOptions(), function (item) {
            if (0 < item.key && item.value()) text = item.caption;
        });

        return text;
    });

    /* Filter Current Bid */
    self.filterCurrentBidOptions = ko.observableArray();

    self.filterCurrentBidDefault = null;
    self.filterCurrentBidKeys = [];

    ko.utils.arrayForEach(BAT_MODEL_LISTINGS_TOOLBAR.filterBidOptions, function (option) {
        self.filterCurrentBidOptions.push({ key: option.value, caption: option.text, value: ko.observable(option.default) });
        self.filterCurrentBidKeys.push(option.value);

        if (option.default) {
            self.filterCurrentBidDefault = option.value;
        }
    });

    self.toggleFilterCurrentBid = function (key) {
        if (false === self.filterCurrentBidKeys.includes(key)) {
            key = self.filterCurrentBidDefault;
        }

        ko.utils.arrayForEach(self.filterCurrentBidOptions(), function (item) {
            item.value(key === item.key);
        });
    }

    self.onKeypressFliterCurrentBid = function (event, key) {
        if (isEnterKey(event)) {
            self.toggleFilterCurrentBid(key);
        }
    }

    self.filterCurrentBid = ko.pureComputed(function () {
        var maxBid = 0;

        ko.utils.arrayForEach(self.filterCurrentBidOptions(), function (item) {
            if (item.value() && '' !== item.key) maxBid = item.key;
        });

        return maxBid;
    }).extend({ throttle: 100 });

    self.filterCurrentBidText = ko.pureComputed(function () {
        var text = '';

        ko.utils.arrayForEach(self.filterCurrentBidOptions(), function (item) {
            if (0 < item.key && item.value()) text = item.caption;
        });

        return text;
    });

    /* Filter Term Exclude */
    self.filterTermExclude = ko.observable('').extend({ throttle: 1000 });

    /* Filter Admin Options */
    self.filterAdminOptions = ko.observableArray();

    ko.utils.arrayForEach(BAT_MODEL_LISTINGS_TOOLBAR.filterAdmin, function (adminOption) {
        self.filterAdminOptions.push({ key: adminOption.value, caption: adminOption.text, value: ko.observable(false) });
    });

    self.toggleFilterAdmin = function (key, value) {
        ko.utils.arrayForEach(self.filterAdminOptions(), function (item) {
            if (key === item.key) {
                item.value('undefined' === typeof value ? !item.value() : value);
            }
        });
    }

    self.onKeyPressFilterAdmin = function (event, key) {
        if (isEnterKey(event)) {
            self.toggleFilterAdmin(key);
        }
    }

    self.filterAdminSelectedText = ko.observable('');

    self.filterAdminEnabled = ko.observable(self.userAdmin);

    self.filterAdminSelectedNumber = ko.pureComputed(function () {
        var number = 0;
        var captions = [];

        ko.utils.arrayForEach(self.filterAdminOptions(), function (item) {
            if (item.value()) {
                number++;
                captions.push(item.caption);
            }
        });

        self.filterAdminSelectedText(captions.join(', '));

        return number;
    });

    /* General functions */
    self.getOptionValue = function (set, key) {
        return ko.utils.unwrapObservable(ko.utils.arrayFirst(set, function (item) {
            return key === item.key;
        }).value);
    };

    /* URL Synchronization. Load filter options from the URL and update the URL with the selected filter options. */
    self.loadedFromURL = false;

    var updateUrlFromArray = function (uri, param, source) {
        uri.removeQuery(param);
        ko.utils.arrayForEach(source, function (item) {
            if (item.value() && item.key) {
                uri.addQuery(param, item.key);
            }
        });
    }

    var updateUrlFromBool = function (uri, param, source) {
        uri.removeQuery(param);
        if (source) {
            uri.addQuery(param, 'yes');
        }
    }

    var updateUrlFromString = function (uri, param, source) {
        uri.removeQuery(param);
        var value = source.toString().trim();
        if (value) {
            uri.addQuery(param, value);
        }
    }

    self.updateUrl = function () {
        if (!self.loadedFromURL) {
            return;
        }

        var uri = new URI();

        uri.removeQuery('sortby');
        if (['ta', 'ba', 'bd'].includes(self.sortBy()) || 'location' === self.sortBy() && self.userLocation()) {
            uri.addQuery('sortby', self.sortBy());
        }

        updateUrlFromString(uri, 'search', self.filterTerm());
        updateUrlFromBool(uri, 'watched', self.filterWatched());
        updateUrlFromBool(uri, 'following', self.filterSubscribed());
        updateUrlFromArray(uri, 'location', self.filterLocationsOptionsUngrouped());
        updateUrlFromArray(uri, 'type', self.filterTypeOptions());
        updateUrlFromArray(uri, 'category', self.filterCategoriesOptions());
        updateUrlFromArray(uri, 'era', self.filterErasOptions());
        updateUrlFromArray(uri, 'origin', self.filterOriginsOptions());
        updateUrlFromString(uri, 'yearFrom', self.filterYearRangeBeg());
        updateUrlFromString(uri, 'yearTo', self.filterYearRangeEnd());
        updateUrlFromArray(uri, 'ending', self.filterEndingWithinOptions());
        updateUrlFromArray(uri, 'bidTo', self.filterCurrentBidOptions());
        updateUrlFromString(uri, 'exclude', self.filterTermExclude());

        uri.removeQuery('processing');
        if (self.userAdmin) {
            updateUrlFromArray(uri, 'processing', self.filterAdminOptions());
        }

        window.history.replaceState('', '', uri);
    }

    var loadArrayFromURL = function (uriQuery, param, target) {
        if (undefined !== uriQuery[param]) {
            uriQuery[param] = 'string' === typeof uriQuery[param] ? [uriQuery[param]] : uriQuery[param];
            uriQuery[param].forEach(function (value) {
                target(value.trim(), true);
            });
        }
    }

    var loadBoolFromURL = function (uriQuery, param, target) {
        if (undefined !== uriQuery[param] && 'yes' === uriQuery[param].trim().toLowerCase()) {
            target(true);
        }
    }

    var loadIntFromURL = function (uriQuery, param, target, min, max) {
        if (undefined !== uriQuery[param]) {
            var value = parseInt(uriQuery[param]);
            if (!isNaN(value) && min <= value && max >= value) {
                target(value);
            }
        }
    }

    var loadStringFromURL = function (uriQuery, param, target) {
        if ('string' === typeof uriQuery[param]) {
            target(uriQuery[param].trim());
        }
    }

    self.loadFromUrl = function () {
        var uri = new URI();
        var uriQuery = uri.query(true);

        if ('string' === typeof uriQuery['sortby'] && (['td', 'ta', 'ba', 'bd'].includes(uriQuery['sortby']) || ('location' === uriQuery['sortby'] && self.userLocation()))) {
            self.sortBy(uriQuery['sortby']);
        }

        loadStringFromURL(uriQuery, 'search', self.filterTerm);
        loadBoolFromURL(uriQuery, 'watched', self.filterWatched);
        loadBoolFromURL(uriQuery, 'following', self.filterSubscribed);
        loadArrayFromURL(uriQuery, 'location', self.toggleFilterLocation);
        loadArrayFromURL(uriQuery, 'type', self.toggleFilterType);
        loadArrayFromURL(uriQuery, 'category', self.toggleFilterCategory);
        loadArrayFromURL(uriQuery, 'era', self.toggleFilterEra);
        loadArrayFromURL(uriQuery, 'origin', self.toggleFilterOrigin);
        loadIntFromURL(uriQuery, 'yearFrom', self.filterYearRangeBeg, minYear, maxYear);
        loadIntFromURL(uriQuery, 'yearTo', self.filterYearRangeEnd, minYear, maxYear);
        loadArrayFromURL(uriQuery, 'ending', self.toggleFilterEndingWithin);
        loadArrayFromURL(uriQuery, 'bidTo', self.toggleFilterCurrentBid);
        loadStringFromURL(uriQuery, 'exclude', self.filterTermExclude);

        if (self.userAdmin) {
            loadArrayFromURL(uriQuery, 'processing', self.toggleFilterAdmin);
        }

        self.loadedFromURL = true;

        self.updateUrl(); // Update the URL with corrected parameters if the user has incorrect ones in the address bar.
    }

    self.toolbarInteracted = ko.observable((new Date()).getTime());

    self.filtersApplied = ko.computed(function () {
        if (self.$element) {
            self.$element.trigger('toolbarInteracted');
        }

        var number = 0;

        number += self.filterWatched() ? 1 : 0;
        number += self.filterSubscribed() ? 1 : 0;
        number += self.filterLocationsSelectedNumber();
        number += self.filterTypeSelectedNumber();
        number += self.filterAdminSelectedNumber();
        number += self.filterCategoriesSelectedNumber();
        number += self.filterErasSelectedNumber();
        number += self.filterOriginsSelectedNumber();
        number += '' !== self.filterYearRangeBeg() ? 1 : 0;
        number += '' !== self.filterYearRangeEnd() ? 1 : 0;
        number += '' !== self.filterEndingWithinText() ? 1 : 0;
        number += '' !== self.filterCurrentBidText() ? 1 : 0;
        number += '' !== self.filterTermExclude() ? 1 : 0;

        self.selectedOptionsNumber(number);

        number += '' !== self.filterTerm() ? 1 : 0;

        self.sortBy(); //do not remove this line, it is makes knockout.js to run this function (self.filtersApplied), when users changes sorting.

        self.toolbarInteracted((new Date()).getTime());

        self.updateUrl();

        return 0 < number;
    });

    self.resetFilters = function () {
        self.filterTerm('');
        self.filterWatched(false);
        self.filterSubscribed(false);
        self.filterYearRangeBeg('');
        self.filterYearRangeEnd('');
        self.filterTermExclude('');

        ko.utils.arrayForEach(self.filterLocationsOptions(), function (item) {
            item.value(false);

            if (item.suboptions().length) {
                ko.utils.arrayForEach(item.suboptions(), function (subitem) {
                        subitem.value(false);
                });
            }
        });

        ko.utils.arrayForEach(self.filterTypeOptions(), function (item) {
            item.value(false);
        });

        ko.utils.arrayForEach(self.filterAdminOptions(), function (item) {
            item.value(false);
        });

        ko.utils.arrayForEach(self.filterCategoriesOptions(), function (item) {
            item.value(false);
        });

        ko.utils.arrayForEach(self.filterErasOptions(), function (item) {
            item.value(false);
        });

        ko.utils.arrayForEach(self.filterOriginsOptions(), function (item) {
            item.value(false);
        });

        ko.utils.arrayForEach(self.filterEndingWithinOptions(), function (item) {
            item.value(false);
        });

        ko.utils.arrayForEach(self.filterCurrentBidOptions(), function (item) {
            item.value(false);
        });
    }

    self.onKeyPressResetFilters = function (event) {
        if(isEnterKey(event)){
            self.resetFilters();
        }
    }

    self.loadInitialData = function (data) {
        if ('undefined' !== typeof data.locations) {
            self.filterLocationsInit(data.locations);
        }

        self.loadFromUrl();
    }

    self.afterRender = function (element) {
        self.$element = jQuery(element);

        self.$mobleFilterForm = self.$element.find('.toolbar-filters-mobile').first();

        function dropdownClickHandler() {
            var dropdown = jQuery(this).parent();
            var active = dropdown.hasClass('active');

            jQuery('.toolbar-dropdown').removeClass('active');
            if (!active) dropdown.addClass('active');

            if (dropdown.closest('.toolbar-filters-mobile').length) {
                var clientRect = dropdown[0].getBoundingClientRect();

                //120px additional offset (the height of '.floating-panel' element)
                var offset = clientRect.top + clientRect.height - self.$mobleFilterForm.outerHeight() + 120;
                if (clientRect.height > self.$mobleFilterForm.outerHeight() - 120) {
                    self.$mobleFilterForm[0].scrollTo({ top: dropdown.position().top + 64 - 10, behavior: 'smooth' });
                } else if (0 < offset) {
                    self.$mobleFilterForm[0].scrollTo({ top: self.$mobleFilterForm.scrollTop() + offset, behavior: 'smooth' });
                }
            }
        }

        self.$element.find('.dropdown-title').on('click', dropdownClickHandler);
        self.$element.find('.dropdown-title').on('keypress', (event) => {

            if (isEnterKey(event)) {
                dropdownClickHandler.bind(event.currentTarget)();
            }
        });

        self.$element.find('.dropdown-title').on('focus', () => {
            jQuery('.toolbar-dropdown:not(.clickoutside-off)').removeClass('active');
        })

        self.$element.find('.toolbar-dropdown').clickOutside(function () {
            jQuery('.toolbar-dropdown:not(.clickoutside-off)').removeClass('active');
        });

        self.$element.find('.toolbar-filters-desktop .toolbar-dropdown .option-radio').on('click', function () {
            jQuery('.toolbar-dropdown').removeClass('active');
        });

        self.$element.find('.toolbar-mobile-filter-toggle').on('click', function () {
            self.$mobleFilterForm.scrollTop(0);
            self.$mobleFilterForm.toggle();
        });

        self.$mobleFilterForm.find('.btn-close-form').on('click', function () {
            self.$mobleFilterForm.toggle(false);
        });

        self.$mobleFilterForm.on('scroll', function (event) { // 'overscroll-behavior: none' does not seem to work properly in iOS Safari. This trick fixes the issue. Perhaps there is a better way to fix this.
            if (event.target.scrollTop === event.target.scrollHeight - event.target.clientHeight) {
                event.target.scrollTop = event.target.scrollHeight - event.target.clientHeight - 1;
            } else if (0 === event.target.scrollTop) {
                event.target.scrollTop = 1;
            }
        });

        var scrollBox = function ($container) {

            var $scrollContainer = $container.find('.scroll-container').first();
            var $overflowArrowLeft = $container.find('.overflow-arrow-left');
            var $overflowArrowRight = $container.find('.overflow-arrow-right');

            $scrollContainer.find('>div').on('click', function (event) {
                recalculateOffset(jQuery(this));
            });

            $overflowArrowLeft.find('span').on('click', function () {
                var offsetLeft = Math.min(0, $scrollContainer.position().left + $container[0].clientWidth / 3);

                $scrollContainer.animate({
                    left: offsetLeft,
                }, 200, recalculateOffset);
            });

            $overflowArrowRight.find('span').on('click', function () {
                var maxLeft = $container[0].clientWidth - $scrollContainer[0].scrollWidth;
                var offsetLeft = Math.max(maxLeft, $scrollContainer.position().left - $container[0].clientWidth / 3);

                $scrollContainer.animate({
                    left: offsetLeft,
                }, 200, recalculateOffset);
            });

            $container.closest('.listings-toolbar').on('toolbarInteracted', function () {
                recalculateOffset();
            });

            var recalculateOffset = function ($activeElement) {
                var offsetLeft = $scrollContainer.position().left;

                if ('undefined' !== typeof $activeElement) {
                    var marginL = 0 < $activeElement.position().left ? 54 : 0; //54px - left arrow width
                    var marginR = $container[0].clientWidth < ($activeElement.position().left + $activeElement.width()) ? 54 : 0; //54px - right arrow width

                    var offsetLeftMax = -$activeElement.position().left + marginL;
                    var offsetLeftMin = $container[0].clientWidth - $activeElement.position().left - $activeElement.width() - marginR;

                    if (offsetLeftMin < offsetLeft) {
                        offsetLeft = offsetLeftMin;
                    }

                    if (offsetLeftMax > offsetLeft) {
                        offsetLeft = offsetLeftMax;
                    }
                }

                var maxLeft = $container[0].clientWidth - $scrollContainer[0].scrollWidth;
                if (-offsetLeft > -maxLeft) {
                    offsetLeft = maxLeft;
                }
                $scrollContainer.css('left', offsetLeft);

                $overflowArrowLeft.toggle(offsetLeft < 0);
                $overflowArrowRight.toggle($scrollContainer[0].scrollWidth > $container[0].clientWidth && offsetLeft > maxLeft);
            }

            var onResize = function () {
                if (599 < jQuery(window).width()) { //599px - is a breakpoint where we switch between mobile and desktop views, corresponds to the same value defined in CSS.
                    jQuery('.toolbar-dropdown').removeClass('active');
                    self.$mobleFilterForm.toggle(false);
                }
                recalculateOffset();
            }

            jQuery(window).resize(lodash.debounce(onResize, 50)).trigger('resize');
        }

        scrollBox(self.$element.find('.toolbar-filters-desktop'));
        scrollBox(self.$element.find('.filters-applied'));
    }
};
;
var AuctionsCurrentViewModel = function (toolbarVM, listings) {
    var self = this;

    self.toolbarVM = toolbarVM;

    self.items = ko.observableArray();

    self.itemsVisible = 'active';

    self.pusher = 'undefined' !== typeof BAT_WEBSERVICES_PUSHER ? BAT_WEBSERVICES_PUSHER : false;

    self.filteringDisabled = ko.observable(false);

    self.showDistances = ko.pureComputed(function () {
        return 'location' === self.toolbarVM.sortBy();
    });

    self.listingsView = ko.pureComputed(function () {
        return ('undefined' !== typeof(self.toolbarVM) && 'list' === self.toolbarVM.listingsView()) ? 'list' : 'grid';
    });

    self.toolbarVM.toolbarInteracted.subscribe(function () {
        self.pagesToDisplayCount(1);
    });

    self.toolbarVM.userLocation.subscribe(function () {
        self.recalculateDistances();
    });

    self.currentTimestamp = ko.observable();

    self.itemsPerPage = 50;  // Items per page for infinity scroll
    self.pagesToDisplayCount = ko.observable(1);
    self.itemsToDisplayCount = ko.pureComputed(function () {
        return self.pagesToDisplayCount() * self.itemsPerPage;
    });

    self.itemsFiltered = ko.pureComputed(function () {

        if (self.filteringDisabled() || 'undefined' === typeof(self.toolbarVM)) {
            return self.items();
        }

        var filterTerm = jQuery.trim(self.toolbarVM.filterTerm());

        var filterTypeNoReserve = self.toolbarVM.getOptionValue(self.toolbarVM.filterTypeOptions(), 'noreserve');
        var filterTypePremium   = self.toolbarVM.getOptionValue(self.toolbarVM.filterTypeOptions(), 'premium');
        var filterTypeRepeat    = self.toolbarVM.getOptionValue(self.toolbarVM.filterTypeOptions(), 'repeat');

        var filterAdminPrClassic    = self.toolbarVM.getOptionValue(self.toolbarVM.filterAdminOptions(), 'pr_classic');
        var filterAdminPrPlus       = self.toolbarVM.getOptionValue(self.toolbarVM.filterAdminOptions(), 'pr_plus');
        var filterAdminPrWhiteglove = self.toolbarVM.getOptionValue(self.toolbarVM.filterAdminOptions(), 'pr_whiteglove');

        var filterLocations     = self.toolbarVM.filterLocations();
        var filterCategories    = self.toolbarVM.filterCategories();
        var filterEras          = self.toolbarVM.filterEras();
        var filterOrigins       = self.toolbarVM.filterOrigins();
        var filterYearRangeBeg  = parseInt(self.toolbarVM.filterYearRangeBeg());
        var filterYearRangeEnd  = parseInt(self.toolbarVM.filterYearRangeEnd());
        var filterEndingWithin  = parseInt(self.toolbarVM.filterEndingWithin());
        var filterCurrentBid    = parseInt(self.toolbarVM.filterCurrentBid());
        var filterTermExclude   = jQuery.trim(self.toolbarVM.filterTermExclude());

        var filterEndingTimestamp = Math.floor((new Date()).getTime() / 1000) + 3600 * filterEndingWithin;

        var itemsFiltered = self.items().filter(function (item) {

            if (self.toolbarVM.filterWatched() && !item.watched()) {
                return false;
            }

            if (self.toolbarVM.filterSubscribed() && !item.inSubscription) {
                return false;
            }

            if ((filterTypeNoReserve || filterTypePremium || filterTypeRepeat) && !((filterTypeNoReserve && item.noreserve) || (filterTypePremium && item.premium) || (filterTypeRepeat && item.repeat))) {
                return false;
            }

            if ((filterAdminPrClassic || filterAdminPrPlus || filterAdminPrWhiteglove) && !((filterAdminPrClassic && 'classic' === item.processingType) || (filterAdminPrPlus && 'plus' === item.processingType) || (filterAdminPrWhiteglove && 'whiteglove' === item.processingType))) {
                return false;
            }

            if (filterLocations.length && !filterLocations.includes(item.country_code)) {
                return false;
            }

            if (filterCategories.length) {
                var inCategory = false;
                for (var i = 0; i < item.categories.length; i++) {
                    if (filterCategories.includes(item.categories[i])) {
                        inCategory = true;
                        break;
                    }
                }
                if (!inCategory) return false;
            }

            if (filterEras.length && !filterEras.includes(item.era)) {
                return false;
            }

            if (filterOrigins.length) {
                var inOrigin = false;
                for (var i = 0; i < item.categories.length; i++) {
                    if (filterOrigins.includes(item.categories[i])) {
                        inOrigin = true;
                        break;
                    }
                }
                if (!inOrigin) return false;
            }

            if (filterYearRangeBeg > 0 && item.year < filterYearRangeBeg) {
                return false;
            }

            if (filterYearRangeEnd > 0 && item.year > filterYearRangeEnd) {
                return false;
            }

            if (filterEndingWithin > 0 && item.initialTimestampEnd > filterEndingTimestamp) {
                return false;
            }

            if (filterCurrentBid > 0 && (!item.currentBid() || item.currentBid() > filterCurrentBid)) {
                return false;
            }

            if (1 < filterTerm.length && !self.serachTermInData(filterTerm, item, true)) {
                return false;
            }

            if (1 < filterTermExclude.length && self.serachTermInData(filterTermExclude, item, false)) {
                return false;
            }

            return true;
        });

        self.toolbarVM.filteredNumber(itemsFiltered.length);

        BaT_Theme.updateCurrentAuctionsFooter(itemsFiltered.length, self.items().length); // TODO:BAT-700 Keep this as is for now, but perhaps this may be reworked (create Current Auctions Footer View Model)

        return itemsFiltered.sort(function (a, b) { // Sort items
            switch (self.toolbarVM.sortBy()) {
                case 'bd': // Sorting by Current Bid DESC
                    if (a.initialCurrentBid === b.initialCurrentBid) {
                        return a.initialTimestampEnd > b.initialTimestampEnd ? 1 : -1;
                    }
                    return a.initialCurrentBid < b.initialCurrentBid ? 1 : -1;

                case 'ba': // Sorting by Current Bid ASC
                    if (a.initialCurrentBid === b.initialCurrentBid) {
                        return a.initialTimestampEnd > b.initialTimestampEnd ? 1 : -1;
                    }
                    return a.initialCurrentBid > b.initialCurrentBid ? 1 : -1;

                case 'td': // Sorting by Ending time DESC
                    return a.initialTimestampEnd > b.initialTimestampEnd ? 1 : -1;

                case 'ta': // Sorting by Ending time ASC
                    return a.initialTimestampEnd < b.initialTimestampEnd ? 1 : -1;

                case 'location': // Sorting by distance
                    if (null !== a.distance() && null !== b.distance() ) {
                        return a.distance() > b.distance() ? 1 : -1;
                    } else if (null === a.distance() && null === b.distance() ) {
                        return 0;
                    } else {
                        return null === a.distance() ? 1 : -1;
                    }

                default:
                    return a.initialTimestampEnd > b.initialTimestampEnd ? 1 : -1; // Default sorting by Initial Ending time DESC
            }
        }).slice(0, self.itemsToDisplayCount());
    });

    self.addItem = function (item) {
        item.showLive = false;
        item.showStats = false;
        item.soldText = false;

        self.items.push(item);
        self.pusher.subscribe(item.pusher);
    }

    self.addItemsBulk = function (itemsToAdd) {
        if ('undefined' === typeof(itemsToAdd)) {
            return;
        }

        self.toolbarVM.listingsNumber(itemsToAdd.length);

        self.items.removeAll();

        self.filteringDisabled(true);
        for (var i = 0; i < Math.min(itemsToAdd.length, self.itemsPerPage); i ++) {
            self.addItem(new ListingCardViewModel(itemsToAdd[i], self));
        }
        self.filteringDisabled(false);

        setTimeout(function() {
            self.filteringDisabled(true);
            for (var i = Math.min(itemsToAdd.length, self.itemsPerPage); i < itemsToAdd.length; i ++) {
                self.addItem(new ListingCardViewModel(itemsToAdd[i], self));
            }
            self.filteringDisabled(false);

            self.recalculateDistances();

            jQuery(document).trigger('scroll');
        }, 1000);
    }

    self.getItemById = function (itemId) {
        return ko.utils.arrayFirst(self.items(), function (item) {
            return item.id === itemId;
        });
    };

    self.recalculateDistances = function () {
        self.filteringDisabled(true);

        var location = self.toolbarVM.userLocation(),
        userZip = location ? location.zipCode : false,
        userLat = location ? location.lat : false,
        userLon = location ? location.lon : false;

        ko.utils.arrayForEach(self.items(), function (item) {
            var distance = null;

            if (userLat && userLon && item.lat && item.lon) {
                distance = BaT_Theme.distanceBetweenCoordinates(userLat, userLon, item.lat, item.lon);
                item.distanceText(BaT_Theme.formatDistanceInMiles(distance));
                item.distanceFrom(BaT_Theme.closestToZipFromText + ' ' + userZip);
            } else if (0 !== item.country.length) {
                item.distanceText(item.country);
                item.distanceFrom('');
            } else {
                item.distanceText(BaT_Theme.closestToZipNADistanceText);
                item.distanceFrom('');
            }

            item.distance(distance);
        });

        self.filteringDisabled(false);
    };

    self.serachTermInData =  function (terms, item, allReqired) {
        var terms = terms.split(/\s+/).filter(function (term) { return '' !== term; });

        if (0 < terms.length) {
            var comparer = function (stringToCompare, term) {
                var compare = stringToCompare.toString().toLowerCase(),
                    regex = new RegExp('(^|\\s)+' + term);

                return compare.match(regex);
            };

            var term, found;

            for (var i = 0; i < terms.length; i++) {
                term = jQuery.trim(terms[i].toLowerCase());

                found = false;

                if (comparer(item.title, term) || comparer(item.searchable, term) || comparer(item.excerpt, term)) {
                    found = true;
                }

                if (!found && allReqired) { // at least one term was not found but all the terms should be found in the item data
                    return false;
                }

                if (found && !allReqired) { // at least one term was found and that is enough
                    return true;
                }
            }

            return found;
        }

        return false;
    }

    self.addItemsBulk(listings);

    self.pusher.bind(true, 'metadata-updated', function (data) {
        var item = self.getItemById(data.post_id);

        if (item && 'undefined' !== typeof data.listing_card_data) {
            item.currentBid(data.listing_card_data.current_bid);
            item.initialCurrentBid = data.listing_card_data.current_bid;
            item.currentBidFormatted(data.listing_card_data.current_bid_formatted);
            item.currentBidLabel(data.listing_card_data.current_bid_label);
            item.timestampEnd(data.listing_card_data.timestamp_end);
            item.initialTimestampEnd = data.listing_card_data.timestamp_end;
        }
    });

    jQuery(document).scroll(function () { // infinity scroll
        var $document = jQuery(document);

        if (($document.height() - jQuery(window).height() - $document.scrollTop()) < jQuery(window).height() && (self.itemsToDisplayCount() < self.items().length)) {
            self.pagesToDisplayCount(self.pagesToDisplayCount() + 1);
        }
    });

    self.loadInitialData = function (data) {
        if ('undefined' === typeof data) {
            return;
        }

        self.addItemsBulk(data.items);
    }

    setInterval(function () {
        self.currentTimestamp(Math.floor((new Date()).getTime() / 1000));
    }, 1000);
};
;
var ListingsCompletedToolbarViewModel = function (listingsType) {

    var self = this;

    self.listingsType = listingsType;

    self.itemsFilteredNumber = ko.observable(0);
    self.itemsTotalNumber    = ko.observable(0);
    self.itemsLoading        = ko.observable(false);

    self.filtersChanged        = ko.observable(false);
    self.selectedOptionsNumber = ko.observable(0);

    self.itemsFilteredNumberText = ko.pureComputed(function () {
        return self.itemsLoading() || self.filtersChanged() ? BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.textLoading : self.itemsFilteredNumber().toLocaleString('en-US') + ' ' + BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.captionAllResults;
    });

    self.userLoggedIn = BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.userLoggedIn;

    self.userAdmin = BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.userAdmin;

    self.baseFilter = {};

    self.sPlaceholder = ko.observable(BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.sPlaceholder);

    self.statsEnabled = ko.observable(false);
    self.statsLoading = ko.observable(false);

    self.sortByDefault = 'td'; // Sorting by Ending time DESC

    const minYear = 1800;
    const maxYear = (new Date()).getFullYear();

    self.showEmptyResultsMessage = ko.pureComputed(function () {
        return 0 < self.itemsTotalNumber() && 0 === self.itemsFilteredNumber() && !(self.itemsLoading() || self.filtersChanged());
    });

    self.showLoadingMessage = ko.pureComputed(function () {
        return 0 < self.itemsTotalNumber() && 0 === self.itemsFilteredNumber() && (self.itemsLoading() || self.filtersChanged());
    });

    /* Sorting */
    self.sortingOptions = ko.observableArray([{key: 'td', caption: BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.textSortByTimeEndDesc},
        {key: 'vd', caption: BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.textSortByViewsDesc},
        {key: 'bd', caption: BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.textSortByBidsDesc},
        {key: 'ta', caption: BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.textSortByTimeEndAsc}]);

    self.sortBy = ko.observable(self.sortByDefault);

    self.sortByDisplay = ko.pureComputed(function () {
        var sortBy = self.sortBy();
        var sortByDisplay = '-';
        ko.utils.arrayForEach(self.sortingOptions(), function (item) {
            if (sortBy === item.key) {
                sortByDisplay =  item.caption;
            }
        });

        return sortByDisplay;
    });

    const isEnterKey = (event) => {
        const keyCode = (event.which ? event.which : event.keyCode);
        return keyCode === 13
    }

    self.setSortBy = function (key) {
        jQuery('.toolbar-dropdown').removeClass('active');

        if (['td', 'vd', 'bd', 'ta'].includes(key)) {
            self.sortBy(key);
        }
    }

    self.onKeypressSortBy = function (event, key) {
        if (isEnterKey(event)) {
            self.setSortBy(key);
        }
    }

    /* Search Term*/
    self.filterTerm = ko.observable('').extend({ throttle: 750 });

    /* Filter Watched */
    self.filterWatched = ko.observable(false);

    self.toggleFilterWatch = function () {
        self.filterWatched(!self.filterWatched());
    }

    self.onKeypressWatched = function (data, event) {
        if (isEnterKey(event)) {
            self.toggleFilterWatch();
        }
    }

    /* Filter Subsribed */
    self.filterSubscribedEnabled = ko.observable(true);

    self.filterSubscribed = ko.observable(false);

    self.toggleFilterSubscribed = function () {
        self.filterSubscribed(!self.filterSubscribed());
    }
    self.onKeypressSubscribed = function (data, event) {
        if (isEnterKey(event)) {
            self.toggleFilterSubscribed();
        }
    }

    /* Filter Locations */
    self.filterLocationsOptions = ko.observableArray();

    self.filterLocationsOptionsUngrouped = ko.observableArray();

    self.filterLocationsEnabled = ko.observable(true);

    self.filterLocationsInit = function (locations) {
        ko.utils.arrayForEach(locations, function (location) {
            var countries = ko.observableArray();

            ko.utils.arrayForEach(location.countries, function (country) {
                countries.push({ key: country.id.toString(), caption: country.title, value: ko.observable(false) });
            });

            self.filterLocationsOptions.push({ key: location.id.toString(), caption: location.title, value: ko.observable(false), suboptions: countries });
        });
    }

    self.toggleFilterLocation = function (key, value) {
        ko.utils.arrayForEach(self.filterLocationsOptions(), function (item) {
            var toggleGroup = false;
            var subGroupSelected = 0;

            if (key === item.key) {
                toggleGroup = true;
                value = 'undefined' === typeof value ? !item.value() : value;
                item.value(value);
            }

            if (item.suboptions().length) {
                ko.utils.arrayForEach(item.suboptions(), function (subitem) {
                    if (key === subitem.key || toggleGroup) {
                        value = 'undefined' === typeof value ? !subitem.value() : value;
                        subitem.value(value);
                    }

                    subGroupSelected += subitem.value() ? 1 : 0;
                });
            }

            item.value(subGroupSelected === item.suboptions().length);
        });
    }

    self.onKeypressFliterLocation = function (event, key) {
        if (isEnterKey(event)) {
            self.toggleFilterLocation(key);
        }
    }

    self.filterLocationsSelectedText = ko.observable('');

    self.filterLocationsSelectedNumber = ko.pureComputed(function () {
        var number = 0;
        var captions = [];

        self.filterLocationsOptionsUngrouped.removeAll();

        ko.utils.arrayForEach(self.filterLocationsOptions(), function (item) {
            if (item.suboptions().length) {
                ko.utils.arrayForEach(item.suboptions(), function (subitem) {
                    if (subitem.value()) {
                        number++;
                        captions.push(subitem.caption);
                        self.filterLocationsOptionsUngrouped.push(subitem);
                    }
                });
            }
        });

        self.filterLocationsSelectedText(captions.join(', '));

        return number;
    });

    /* Filter Listing types */
    self.filterTypeOptions = ko.observableArray([
        {key: 'noreserve', caption: BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.textNoReserve, value: ko.observable(false), visible: true},
        {key: 'premium', caption: BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.textPremium, value: ko.observable(false), visible: true},
        {key: 'repeat', caption: BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.textRepeat, value: ko.observable(false), visible: true}]);

    self.toggleFilterType = function (key, value) {
        ko.utils.arrayForEach(self.filterTypeOptions(), function (item) {
            if (key === item.key) {
                item.value('undefined' === typeof value ? !item.value() : value);
            }
        });
    }

    self.onKeypressFliterType = function (event, key) {
        if (isEnterKey(event)) {
            self.toggleFilterType(key);
        }
    }

    self.filterTypeSelectedNumber = ko.pureComputed(function () {
        var number = 0;
        ko.utils.arrayForEach(self.filterTypeOptions(), function (item) {
            number += item.value() ? 1 : 0;
        });
        return number;
    });

    /* Filter Categories */
    self.filterCategoriesOptions = ko.observableArray();

    ko.utils.arrayForEach(BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.categories, function (category) {
        self.filterCategoriesOptions.push({key: category.id.toString(), caption: category.title, value: ko.observable(false)});
    });

    self.toggleFilterCategory = function (key, value) {
        ko.utils.arrayForEach(self.filterCategoriesOptions(), function (item) {
            if (key === item.key) {
                item.value('undefined' === typeof value ? !item.value() : value);
            }
        });
    }

    self.onKeypressFliterCategory = function (event, key) {
        if (isEnterKey(event)) {
            self.toggleFilterCategory(key);
        }
    }

    self.filterCategoriesSelectedText = ko.observable('');

    self.filterCategoriesEnabled = ko.observable(true);

    self.filterCategoriesSelectedNumber = ko.pureComputed(function () {
        var number = 0;
        var captions = [];

        ko.utils.arrayForEach(self.filterCategoriesOptions(), function (item) {
            if (item.value()) {
                number++;
                captions.push(item.caption);
            }
        });

        self.filterCategoriesSelectedText(captions.join(', '));

        return number;
    });

    /* Filter Eras */
    self.filterErasOptions = ko.observableArray();

    ko.utils.arrayForEach(BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.eras, function (era) {
        self.filterErasOptions.push({key: era.id, caption: era.title, value: ko.observable(false)});
    });

    self.toggleFilterEra = function (key, value) {
        ko.utils.arrayForEach(self.filterErasOptions(), function (item) {
            if (key === item.key) {
                item.value('undefined' === typeof value ? !item.value() : value);
            }
        });
    }

    self.onKeypressFliterEra = function (event, key) {
        if (isEnterKey(event)) {
            self.toggleFilterEra(key);
        }
    }

    self.filterErasSelectedText = ko.observable('');

    self.filterErasEnabled = ko.observable(true);

    self.filterErasSelectedNumber = ko.pureComputed(function () {
        var number = 0;
        var captions = [];

        ko.utils.arrayForEach(self.filterErasOptions(), function (item) {
            if (item.value()) {
                number++;
                captions.push(item.caption);
            }
        });

        self.filterErasSelectedText(captions.join(', '));

        return number;
    });

    /* Filter Origin */
    self.filterOriginsOptions = ko.observableArray();

    ko.utils.arrayForEach(BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.origins, function (origin) {
        self.filterOriginsOptions.push({key: origin.id.toString(), caption: origin.title, value: ko.observable(false)});
    });

    self.toggleFilterOrigin = function (key, value) {
        ko.utils.arrayForEach(self.filterOriginsOptions(), function (item) {
            if (key === item.key) {
                item.value('undefined' === typeof value ? !item.value() : value);
            }
        });
    }

    self.onKeypressFliterOrigin = function (event, key) {
        if (isEnterKey(event)) {
            self.toggleFilterOrigin(key);
        }
    }

    self.filterOriginsSelectedText = ko.observable('');

    self.filterOriginsEnabled = ko.observable(true);

    self.filterOrigins = ko.pureComputed(function () {
        var origins = [];

        ko.utils.arrayForEach(self.filterOriginsOptions(), function (item) {
            if (item.value()) origins.push(item.key);
        });

        return origins;
    }).extend({ throttle: 750 });

    self.filterOriginsSelectedNumber = ko.pureComputed(function () {
        var number = 0;
        var captions = [];

        ko.utils.arrayForEach(self.filterOriginsOptions(), function (item) {
            if (item.value()) {
                number++;
                captions.push(item.caption);
            }
        });

        self.filterOriginsSelectedText(captions.join(', '));

        return number;
    });

    /* Filter Years Range */
    self.filterYearRangeBeg = ko.observable('').extend({ throttle: 1000 });
    self.filterYearRangeEnd = ko.observable('').extend({ throttle: 1000 });

    self.filterYearRangeText = ko.pureComputed(function () {
        var yearBeg = parseInt(self.filterYearRangeBeg());
        var yearEnd = parseInt(self.filterYearRangeEnd());

        if (isNaN(yearBeg) && isNaN(yearEnd)) return '';

        yearBeg = isNaN(yearBeg) ? minYear : yearBeg;
        yearEnd = isNaN(yearEnd) ? maxYear : yearEnd;

        yearBeg = yearBeg > maxYear ? maxYear : yearBeg;
        yearEnd = yearEnd > maxYear ? maxYear : yearEnd;

        return yearBeg.toString() + '-' + yearEnd.toString();
    });

    /* Filter Recency */
    self.filterRecencyOptions = ko.observableArray();

    self.filterRecencyDefault = null;
    self.filterRecencyKeys = [];

    ko.utils.arrayForEach(BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.filterRecencyOptions, function (option) {
        self.filterRecencyOptions.push({key: option.value, caption: option.text, value: ko.observable(option.default)});
        self.filterRecencyKeys.push(option.value);

        if (option.default) {
            self.filterRecencyDefault = option.value;
        }
    });

    self.toggleFilterRecency = function (key) {
        if (false === self.filterRecencyKeys.includes(key)) {
            key = self.filterRecencyDefault;
        }

        ko.utils.arrayForEach(self.filterRecencyOptions(), function (item) {
            item.value(key === item.key);
        });
    }

    self.onKeypressFilterRecency = function (event, key) {
        if (isEnterKey(event)) {
            self.toggleFilterRecency(key);
        }
    }

    self.filterRecency = ko.pureComputed(function () {
        var recency = '';

        ko.utils.arrayForEach(self.filterRecencyOptions(), function (item) {
            if (item.value()) recency = item.key;
        });

        return recency;
    }).extend({ throttle: 100 });

    self.filterRecencyText = ko.pureComputed(function () {
        var text = '';

        ko.utils.arrayForEach(self.filterRecencyOptions(), function (item) {
            if ('' !== item.key && item.value()) text = item.caption;
        });

        return text;
    });

    /* Filter Auction Result */
    self.filterAuctionResultOptions = ko.observableArray();

    self.filterAuctionResultDefault = null;
    self.filterAuctionResultKeys = [];

    ko.utils.arrayForEach(BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.filterAuctionResultOptions, function (option) {
        self.filterAuctionResultOptions.push({key: option.value, caption: option.text, value: ko.observable(option.default)});
        self.filterAuctionResultKeys.push(option.value);

        if (option.default) {
            self.filterAuctionResultDefault = option.value;
        }
    });

    self.toggleFilterAuctionResult = function (key) {
        if (false === self.filterAuctionResultKeys.includes(key)) {
            key = self.filterAuctionResultDefault;
        }

        ko.utils.arrayForEach(self.filterAuctionResultOptions(), function (item) {
            item.value(key === item.key);
        });
    }

    self.onKeypressAuctionResult = function (event, key) {
        if (isEnterKey(event)) {
            self.toggleFilterAuctionResult(key);
        }
    }

    self.filterAuctionResult = ko.pureComputed(function () {
        var result = '';

        ko.utils.arrayForEach(self.filterAuctionResultOptions(), function (item) {
            if (item.value()) result = item.key;
        });

        return result;
    }).extend({ throttle: 100 });

    self.filterAuctionResultText = ko.pureComputed(function () {
        var text = '';

        ko.utils.arrayForEach(self.filterAuctionResultOptions(), function (item) {
            if ('' !== item.key && item.value()) text = item.caption;
        });

        return text;
    });

    /* Filter High Bid */
    self.filterHighBidOptions = ko.observableArray();

    self.filterHighBidDefault = null;
    self.filterHighBidKeys = [];

    ko.utils.arrayForEach(BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.filterBidOptions, function (option) {
        self.filterHighBidOptions.push({key: option.value, caption: option.text, value: ko.observable(option.default)});
        self.filterHighBidKeys.push(option.value);

        if (option.default) {
            self.filterHighBidDefault = option.value;
        }
    });

    self.toggleFilterHighBid  = function (key) {
        if (false === self.filterHighBidKeys.includes(key)) {
            key = self.filterHighBidDefault;
        }

        ko.utils.arrayForEach(self.filterHighBidOptions(), function (item) {
            item.value(key === item.key);
        });
    }

    self.onKeypressHighBid = function (event, key) {
        if (isEnterKey(event)) {
            self.toggleFilterHighBid(key);
        }
    }

    self.filterHighBid = ko.pureComputed(function () {
        var maxBid = 0;

        ko.utils.arrayForEach(self.filterHighBidOptions(), function (item) {
            if (item.value()) maxBid = item.key;
        });

        return maxBid;
    }).extend({ throttle: 100 });

    self.filterHighBidText = ko.pureComputed(function () {
        var text = '';

        ko.utils.arrayForEach(self.filterHighBidOptions(), function (item) {
            if ('' !== item.key && item.value()) text = item.caption;
        });

        return text;
    });

    /* Filter Term Exclude */
    self.filterTermExclude = ko.observable('').extend({ throttle: 750 });

    /* Filter Admin Options */
    self.filterAdminOptions = ko.observableArray();

    ko.utils.arrayForEach(BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.filterAdmin, function (adminOption) {
        self.filterAdminOptions.push({key: adminOption.value, caption: adminOption.text, value: ko.observable(false)});
    });

    self.toggleFilterAdmin = function (key, value) {
        ko.utils.arrayForEach(self.filterAdminOptions(), function (item) {
            if (key === item.key) {
                item.value('undefined' === typeof value ? !item.value() : value);
            }
        });
    }

    self.onKeyPressFilterAdmin = function (event, key) {
        if (isEnterKey(event)) {
            self.toggleFilterAdmin(key);
        }
    }

    self.filterAdminSelectedText = ko.observable('');

    self.filterAdminEnabled = ko.observable(self.userAdmin);

    self.filterAdminSelectedNumber = ko.pureComputed(function () {
        var number = 0;
        var captions = [];

        ko.utils.arrayForEach(self.filterAdminOptions(), function (item) {
            if (item.value()) {
                number++;
                captions.push(item.caption);
            }
        });

        self.filterAdminSelectedText(captions.join(', '));

        return number;
    });

    self.isAuthRequiredForFilters = ko.pureComputed(function() {
        const filtersSelected = self.fitersSelected();
        const authFilters = ['adm_filter', 'subscribed', 'watched'];
        // If none of the specified filters among selected filters, return false
        if (!authFilters.some(key => filtersSelected.hasOwnProperty(key))) {
            return false;
        }

        // If none of the specified filters have a non-empty value, return false. Otherwise, return true.
        return authFilters.some(key => filtersSelected[key] === true || Array.isArray(filtersSelected[key]) && filtersSelected[key].length !== 0)
    });

    /* General functions */
    self.getOptionValue = function(set, key){
        return ko.utils.unwrapObservable(ko.utils.arrayFirst(set, function(item) {
              return key === item.key;
        }).value);
    };

    self.getOptionSelectedKeys = function(set){
        var keys = [];

        ko.utils.arrayForEach(set, function (item) {
            if ('' !== item.key && item.value()) keys.push(item.key);
        });

        return keys;
    }

    /* URL Synchronization. Load filter options from the URL and update the URL with the selected filter options. */
    self.loadedFromURL = false;

    var updateUrlFromArray = function (uri, param, source) {
        uri.removeQuery(param);
        ko.utils.arrayForEach(source, function (item) {
            if (item.value() && item.key) {
                uri.addQuery(param, item.key);
            }
        });
    }

    var updateUrlFromBool = function (uri, param, source) {
        uri.removeQuery(param);
        if (source) {
           uri.addQuery(param, 'yes');
        }
    }

    var updateUrlFromString = function (uri, param, source) {
        uri.removeQuery(param);
        var value = source.toString().trim();
        if (value) {
           uri.addQuery(param, value);
        }
    }

    self.updateUrl = function () {
        if (!self.loadedFromURL) {
            return;
        }

        var uri = new URI();

        uri.removeQuery('sortby');
        if (self.sortByDefault !== self.sortBy()) {
           uri.addQuery('sortby', self.sortBy());
        }

        updateUrlFromString(uri, 'search', self.filterTerm());
        updateUrlFromBool(uri, 'watched', self.filterWatched());
        updateUrlFromBool(uri, 'subscribed', self.filterSubscribed());
        updateUrlFromArray(uri, 'location', self.filterLocationsOptionsUngrouped());
        updateUrlFromArray(uri, 'type', self.filterTypeOptions());
        updateUrlFromArray(uri, 'category', self.filterCategoriesOptions());
        updateUrlFromArray(uri, 'era', self.filterErasOptions());
        updateUrlFromArray(uri, 'origin', self.filterOriginsOptions());
        updateUrlFromString(uri, 'yearFrom', self.filterYearRangeBeg());
        updateUrlFromString(uri, 'yearTo', self.filterYearRangeEnd());
        updateUrlFromArray(uri, 'timeFrame', self.filterRecencyOptions());
        updateUrlFromArray(uri, 'result', self.filterAuctionResultOptions());
        updateUrlFromArray(uri, 'bidTo', self.filterHighBidOptions());
        updateUrlFromString(uri, 'exclude', self.filterTermExclude());

        uri.removeQuery('processing');
        if (self.userAdmin) {
            updateUrlFromArray(uri, 'processing', self.filterAdminOptions());
        }

        window.history.replaceState('', '', uri);
    }

    var loadArrayFromURL = function (uriQuery, param, target) {
        if (undefined !== uriQuery[param]) {
            uriQuery[param] = 'string' === typeof uriQuery[param] ? [uriQuery[param]] : uriQuery[param];
            uriQuery[param].forEach(function (value) {
                target(value.trim(), true);
            });
        }
    }

    var loadBoolFromURL = function (uriQuery, param, target) {
        if (undefined !== uriQuery[param] && 'yes' === uriQuery[param].trim().toLowerCase()) {
            target(true);
        }
    }

    var loadIntFromURL = function (uriQuery, param, target, min, max) {
        if (undefined !== uriQuery[param]) {
            var value = parseInt(uriQuery[param]);
            if (!isNaN(value) && min <= value && max >= value) {
                target(value);
            }
        }
    }

    var loadStringFromURL = function (uriQuery, param, target) {
        if ('string' === typeof uriQuery[param]) {
            target(uriQuery[param].trim());
        }
    }

    self.loadFromUrl = function () {
        var uri = new URI();
        var uriQuery = uri.query(true);

        loadStringFromURL(uriQuery, 'sortby', self.setSortBy);

        loadStringFromURL(uriQuery, 'search', self.filterTerm);
        loadBoolFromURL(uriQuery, 'watched', self.filterWatched);
        self.filterSubscribedEnabled() ? loadBoolFromURL(uriQuery, 'subscribed', self.filterSubscribed) : '';
        loadArrayFromURL(uriQuery, 'location', self.toggleFilterLocation);
        loadArrayFromURL(uriQuery, 'type', self.toggleFilterType);
        loadArrayFromURL(uriQuery, 'category', self.toggleFilterCategory);
        loadArrayFromURL(uriQuery, 'era', self.toggleFilterEra);
        loadArrayFromURL(uriQuery, 'origin', self.toggleFilterOrigin);
        loadIntFromURL(uriQuery, 'yearFrom', self.filterYearRangeBeg, minYear, maxYear);
        loadIntFromURL(uriQuery, 'yearTo', self.filterYearRangeEnd, minYear, maxYear);
        loadArrayFromURL(uriQuery, 'timeFrame', self.toggleFilterRecency);
        loadArrayFromURL(uriQuery, 'result', self.toggleFilterAuctionResult);
        loadArrayFromURL(uriQuery, 'bidTo', self.toggleFilterHighBid);
        loadStringFromURL(uriQuery, 'exclude', self.filterTermExclude);

        if (self.userAdmin) {
            loadArrayFromURL(uriQuery, 'processing', self.toggleFilterAdmin);
        }

        self.loadedFromURL = true;

        self.updateUrl(); // Update the URL with corrected parameters if the user has incorrect ones in the address bar.
    }

    self.filtersApplied = ko.pureComputed(function () {
        var number = 0; // Calculate how many filteing options user has selected (exclude text search field), and display it on frontend, also display the "Reset filters" button if '0 < number' (include text search field)

        number += self.filterWatched() ? 1 : 0;
        number += self.filterSubscribed() ? 1 : 0;
        number += self.filterTypeSelectedNumber();
        number += self.filterLocationsSelectedNumber();
        number += self.filterAdminSelectedNumber();
        number += self.filterCategoriesSelectedNumber();
        number += self.filterErasSelectedNumber();
        number += self.filterOriginsSelectedNumber();
        number += '' !== self.filterYearRangeBeg() ? 1 : 0;
        number += '' !== self.filterYearRangeEnd() ? 1 : 0;
        number += '' !== self.filterRecencyText() ? 1 : 0;
        number += '' !== self.filterAuctionResultText() ? 1 : 0;
        number += '' !== self.filterHighBidText() ? 1 : 0;
        number += '' !== self.filterTermExclude() ? 1 : 0;

        self.selectedOptionsNumber(number);

        number += '' !== self.filterTerm() ? 1 : 0;

        if (self.$element) {
            self.$element.trigger('toolbarInteracted');
        }

        self.sortBy(); //do not remove this line, it is makes knockout.js to run this function (self.filtersApplied), when users changes sorting.

        self.filtersChanged(true);

        self.updateUrl();

        return 0 < number;
    }).extend({ throttle: 25 });

    self.fitersSelected = function () {
        return {
            base_filter:  self.baseFilter,
            adm_filter:   self.getOptionSelectedKeys(self.filterAdminOptions()),
            sort:         self.sortBy(),
            location:     self.getOptionSelectedKeys(self.filterLocationsOptionsUngrouped()),
            category:     self.getOptionSelectedKeys(self.filterCategoriesOptions()),
            eras:         self.getOptionSelectedKeys(self.filterErasOptions()),
            origin:       self.getOptionSelectedKeys(self.filterOriginsOptions()),
            exclude_s:    self.filterTermExclude(),
            maximum_bid:  self.filterHighBid(),
            include_s:    self.filterTerm(),
            minimum_year: self.filterYearRangeBeg(),
            maximum_year: self.filterYearRangeEnd(),
            recency:      self.filterRecency(),
            state:        self.filterAuctionResult(),
            subscribed:   self.filterSubscribed(),
            type:         self.getOptionSelectedKeys(self.filterTypeOptions()),
            watched:      self.filterWatched(),
        }
    }

    self.toolbarInteractionComplete = ko.computed(function () {
        self.fitersSelected();
        self.filtersChanged(false);

        return (new Date()).getTime();
    }).extend({ throttle: 1500 });

    self.resetFilters = function () {
        self.filterTerm('');
        self.filterWatched(false);
        self.filterSubscribed(false);
        self.filterYearRangeBeg('');
        self.filterYearRangeEnd('');
        self.filterTermExclude('');

        ko.utils.arrayForEach(self.filterLocationsOptions(), function (item) {
            item.value(false);

            if (item.suboptions().length) {
                ko.utils.arrayForEach(item.suboptions(), function (subitem) {
                        subitem.value(false);
                });
            }
        });

        ko.utils.arrayForEach(self.filterTypeOptions(), function (item) {
            item.value(false);
        });

        ko.utils.arrayForEach(self.filterAdminOptions(), function (item) {
            item.value(false);
        });

        ko.utils.arrayForEach(self.filterCategoriesOptions(), function (item) {
            item.value(false);
        });

        ko.utils.arrayForEach(self.filterErasOptions(), function (item) {
            item.value(false);
        });

        ko.utils.arrayForEach(self.filterOriginsOptions(), function (item) {
            item.value(false);
        });

        self.toggleFilterRecency('');
        self.toggleFilterAuctionResult('');
        self.toggleFilterHighBid('');
    }

    self.onKeyPressResetFilters = function (event) {
        if(isEnterKey(event)){
            self.resetFilters();
        }
    }

    self.loadInitialData = function (data) {
        if ('undefined' !== typeof data.s_placehoder) {
            self.sPlaceholder(data.s_placehoder);
        }

        if ('undefined' !== typeof data.stats_enabled) {
            self.statsEnabled(data.stats_enabled);
        }

        if ('undefined' !== typeof data.base_filter) {
            self.baseFilter = data.base_filter;

            if ('undefined' !== typeof data.filter_options) {
                self.filterErasEnabled(data.filter_options.filter_era_enabled);
                self.filterOriginsEnabled(data.filter_options.filter_origin_enabled);
                self.filterCategoriesEnabled(data.filter_options.filter_category_enabled);
                self.filterSubscribedEnabled(data.filter_options.filter_subscribed_enabled);
            }
        }

        if ('undefined' !== typeof data.locations) {
            self.filterLocationsInit(data.locations);

            if ('undefined' !== typeof data.filter_options) {
                self.filterLocationsEnabled(data.filter_options.filter_location_enabled);
            }
        } else {
            self.filterLocationsEnabled(false);
        }

        self.loadFromUrl();
    }

    self.updateStatsChart = function (stats) {
        renderStatsChart(stats);
    }

    self.afterRender = function (element) {
        self.$element = jQuery(element);

        self.$mobleFilterForm = self.$element.find('.toolbar-filters-mobile').first();

        function dropdownClickHandler() {
            var dropdown = jQuery(this).parent();
            var active = dropdown.hasClass('active');

            jQuery('.toolbar-dropdown').removeClass('active');
            if (!active) dropdown.addClass('active');

            if (dropdown.closest('.toolbar-filters-mobile').length) {
                var clientRect= dropdown[0].getBoundingClientRect();

                //120px additional offset (the height of '.floating-panel' element)
                var offset = clientRect.top + clientRect.height - self.$mobleFilterForm.outerHeight() + 120;
                if (clientRect.height > self.$mobleFilterForm.outerHeight() - 120) {
                    self.$mobleFilterForm[0].scrollTo({top: dropdown.position().top + 64 - 10, behavior: 'smooth'});
                } else if (0 < offset) {
                    self.$mobleFilterForm[0].scrollTo({top: self.$mobleFilterForm.scrollTop() + offset, behavior: 'smooth'});
                }
            }
        }

        self.$element.find('.dropdown-title').on('click', dropdownClickHandler);
        self.$element.find('.dropdown-title').on('keypress', (event) => {
            if (isEnterKey(event)) {
                dropdownClickHandler.bind(event.currentTarget)();
            }
        });

        self.$element.find('.dropdown-title').on('focus', () => {
            jQuery('.toolbar-dropdown:not(.clickoutside-off)').removeClass('active');
        })

        self.$element.find('.toolbar-dropdown').clickOutside(function () {
            jQuery('.toolbar-dropdown:not(.clickoutside-off)').removeClass('active');
        });

        self.$element.find('.toolbar-filters-desktop .toolbar-dropdown .option-radio').on('click', function () {
            jQuery('.toolbar-dropdown').removeClass('active');
        });

        self.$element.find('.toolbar-mobile-filter-toggle').on('click', function () {
            self.$mobleFilterForm.scrollTop(0);
            self.$mobleFilterForm.toggle();
        });

        self.$mobleFilterForm.find('.btn-close-form').on('click', function () {
            self.$mobleFilterForm.toggle(false);
        });

        self.$mobleFilterForm.on('scroll', function (event) { // 'overscroll-behavior: none' does not seem to work properly in iOS Safari. This trick fixes the issue. Perhaps there is a better way to fix this.
            if (event.target.scrollTop === event.target.scrollHeight - event.target.clientHeight) {
                event.target.scrollTop = event.target.scrollHeight - event.target.clientHeight - 1;
            } else if (0 === event.target.scrollTop) {
                event.target.scrollTop = 1;
            }
        });

        var scrollBox = function ($container) {

            var $scrollContainer = $container.find('.scroll-container').first();
            var $overflowArrowLeft  = $container.find('.overflow-arrow-left');
            var $overflowArrowRight = $container.find('.overflow-arrow-right');

            $scrollContainer.find('>div').on('click', function (event) {
                recalculateOffset(jQuery(this));
            });

            $overflowArrowLeft.find('span').on('click', function () {
                var offsetLeft = Math.min(0, $scrollContainer.position().left + $container[0].clientWidth / 3);

                $scrollContainer.animate({
                    left: offsetLeft,
                }, 200, recalculateOffset);
            });

            $overflowArrowRight.find('span').on('click', function () {
                var maxLeft = $container[0].clientWidth - $scrollContainer[0].scrollWidth;
                var offsetLeft = Math.max(maxLeft, $scrollContainer.position().left - $container[0].clientWidth / 3);

                $scrollContainer.animate({
                    left: offsetLeft,
                }, 200, recalculateOffset);
            });

            $container.closest('.listings-toolbar').on('toolbarInteracted', function () {
                recalculateOffset();
            });

            var recalculateOffset = function ($activeElement) {
                var offsetLeft = $scrollContainer.position().left;

                if ('undefined' !== typeof $activeElement) {
                    var marginL = 0 < $activeElement.position().left ? 54 : 0; //54px - left arrow width
                    var marginR = $container[0].clientWidth < ($activeElement.position().left + $activeElement.width()) ? 54 : 0; //54px - right arrow width

                    var offsetLeftMax = -$activeElement.position().left + marginL;
                    var offsetLeftMin = $container[0].clientWidth - $activeElement.position().left - $activeElement.width() - marginR;

                    if (offsetLeftMin < offsetLeft) {
                        offsetLeft = offsetLeftMin;
                    }

                    if (offsetLeftMax > offsetLeft) {
                        offsetLeft = offsetLeftMax;
                    }
                }

                var maxLeft = $container[0].clientWidth - $scrollContainer[0].scrollWidth;
                if (-offsetLeft > -maxLeft) {
                    offsetLeft = maxLeft;
                }
                $scrollContainer.css('left', offsetLeft);

                $overflowArrowLeft.toggle(offsetLeft < 0);
                $overflowArrowRight.toggle($scrollContainer[0].scrollWidth > $container[0].clientWidth && offsetLeft > maxLeft);
            }

            var onResize = function () {
                if (599 < jQuery(window).width()) { //599px - is a breakpoint where we switch between mobile and desktop views, corresponds to the same value defined in CSS.
                    jQuery('.toolbar-dropdown').removeClass('active');
                    self.$mobleFilterForm.toggle(false);
                }
                recalculateOffset();
            }

            jQuery(window).resize(lodash.debounce(onResize, 50)).trigger('resize');
        }

        scrollBox(self.$element.find('.toolbar-filters-desktop'));
        scrollBox(self.$element.find('.filters-applied'));
    }
}

var renderStatsChart = function(stats) {
    var $chart = jQuery('#chart-drawing');

    if (0 === $chart.length) {
        return;
    }

    //Clear the current chart
    $chart.empty();

    if (null === stats) {
        return;
    }

    var mobile = jQuery(window).width() <= BaT_Theme.screenWidthBreakpoint;

    $chart.append('<canvas id="chart-stats" height="0" width="100%"></canvas>');

    var chart = new Chart('chart-stats', {
        // These are scatter plots
        type: 'scatter',

        // Must provide the data as two separate datasets
        data: {
            datasets: [
                {
                    label: BAT_MODEL_FILTER.labels.chart.sold,

                    // Data points for sold listings
                    data: stats.sold.map(function(stat) { return { x: stat.timestampms, y: stat.amount, stat: stat }; }),

                    // Do not show the line for this dataset (points only)
                    showLine: false,

                    // Dot formatting
                    pointBackgroundColor: '#000000',
                    pointBorderColor: '#000000',
                    pointBorderWidth: 0,
                    pointRadius: 4,

                    // Dot formatting on hover
                    pointHoverBackgroundColor: '#000000',
                    pointHoverBorderColor: '#000000',
                    pointHoverBorderWidth: 0,
                    pointHoverRadius: 4,
                },

                {
                    label: BAT_MODEL_FILTER.labels.chart.unsold,

                    // Data points for reserve not met listings
                    data: stats.unsold.map(function(stat) { return { x: stat.timestampms, y: stat.amount, stat: stat }; }),

                    // Do not show the line for this dataset (points only)
                    showLine: false,

                    // Dot formatting
                    pointBackgroundColor: '#ffffff',
                    pointBorderColor: '#aaaaaa',
                    pointBorderWidth: 0,
                    pointRadius: 4,

                    // Dot formatting on hover
                    pointHoverBackgroundColor: '#ffffff',
                    pointHoverBorderColor: '#aaaaaa',
                    pointHoverBorderWidth: 0,
                    pointHoverRadius: 4,
                }
            ]
        },

        options: {
            animation: false,

            responsive: true,

            maintainAspectRatio: false,

            legend: {
                display: false,
            },

            scales: {
                xAxes: [
                    {
                        type: 'linear',

                        ticks: {
                            callback: function(value, index, values) {
                                return stats.options.ticks.labels[index];
                            },

                            fontColor: '#8f8f8f',

                            max: stats.options.maximum_time,
                            min: stats.options.minimum_time,
                        },

                        afterBuildTicks: function(axis) {
                            if (0 === stats.sold.length && 0 === stats.unsold.length) {
                                axis.ticks = [];
                            } else {
                                axis.ticks = stats.options.ticks.values;
                            }
                        }
                    }
                ],

                yAxes: [
                    {
                        ticks: {
                            beginAtZero: true,

                            fontColor: '#8f8f8f',

                            callback: function(value, index, values) {
                                if (mobile) {
                                    return numeral(value).format('($0a)');
                                } else {
                                    return numeral(value).format('$0,00');
                                }
                            }
                        },

                        afterBuildTicks: function(axis) {
                            if (0 === stats.sold.length && 0 === stats.unsold.length) {
                                axis.ticks = [];
                            }
                        }
                    }
                ]
            },

            tooltips: {
                // Turn off default tooltips
                enabled: false,

                // Turn on custom tooltips
                custom: function(model) {
                    // Tooltip Element
                    var $tooltip = jQuery('#chartjs-tooltip').empty().hide(),
                        $chart   = jQuery('#chart-stats').css('cursor', 'default');

                    if(0 === $tooltip.length) {
                        $tooltip = jQuery('<div class="chartjs-tooltip-bat" id="chartjs-tooltip"></div>').appendTo(jQuery('#chart-drawing')).hide();
                    }

                    if('undefined' === typeof model.dataPoints || 0 === model.dataPoints.length) { return; }

                    var dataPoint = model.dataPoints[0];

                    var stat = this._data.datasets[dataPoint.datasetIndex].data[dataPoint.index].stat;

                    if('undefined' === typeof stat) { return; }

                    var $inner     = jQuery('<div class="chartjs-tooltip-bat-inner"></div>'),
                        $container = jQuery('<div class="chartjs-tooltip-bat-image-container"></div>'),
                        $innerText = jQuery('<div class="chartjs-tooltip-bat-titles"></div>'),
                        // phpcs:ignore WordPressVIPMinimum.JS.HTMLExecutingFunctions.appendTo -- HTML is properly escaped.
                        $title     = jQuery('<div class="chartjs-tooltip-bat-title"></div>').text(stat.title).appendTo($innerText),
                        // phpcs:ignore WordPressVIPMinimum.JS.HTMLExecutingFunctions.appendTo -- HTML is properly escaped.
                        $titleSub  = jQuery('<div class="chartjs-tooltip-bat-titlesub"></div>').text(stat.titlesub).appendTo($innerText),
                        // phpcs:ignore WordPressVIPMinimum.JS.HTMLExecutingFunctions.appendTo -- HTML is properly escaped.
                        $image     = jQuery('<img class="chartjs-tooltip-bat-image" />').attr('src', stat.image).appendTo($container);

                    // phpcs:ignore WordPressVIPMinimum.JS.HTMLExecutingFunctions.append -- HTML is properly escaped.
                    $tooltip.append($inner.append($container).append($innerText));

                    // Hide if no tooltip
                    if(0 === model.opacity) {
                        $chart.css('cursor', 'default');
                        $tooltip.hide();
                    } else {
                        // Have to show for position calculation
                        $chart.css('cursor', 'pointer');
                        $tooltip.css({ opacity: 0 }).show();

                        var positionX = Math.min(jQuery('#chart-drawing').outerWidth() - $tooltip.outerWidth() - 10, Math.max(10, (model.caretX -$tooltip.outerWidth() / 2))),
                            positionY = model.caretY + 5;

                        $tooltip.css({ opacity: 1, left: positionX + 'px', top: positionY + 'px'});
                    }
                }
            },

            onClick: function(event) {
                if('undefined' === typeof this.lastActive || 0 === this.lastActive.length) { return false; }

                var active = this.lastActive[0];

                if('undefined' === typeof active._datasetIndex || 'undefined' === typeof active._index) { return false; }

                var stat = this.data.datasets[active._datasetIndex].data[active._index].stat;

                // Navigate to the listing page when clicking on a datapoint in the chart
                // Open link in new tab on desktop only
                if( mobile ) {
                    document.location.href = stat.url;
                } else {
                    window.open(stat.url, '_blank');
                }
            }
        }
    });

    jQuery(window).trigger('resize');
}

jQuery(window).on('resize', function(event) {
    var $chart = jQuery('#chart-drawing');

    if (0 === $chart.length) {
        return;
    }

    var mobile = jQuery(window).width() <= BaT_Theme.screenWidthBreakpoint;

    var width  = $chart.outerWidth(),
        height = mobile ?  width * (2 / 3) : Math.min(480, width * (2 / 3));

    $chart.height(height);
}).trigger('resize');
;
var AuctionsCompletedViewModel = function (toolbarVM, initialData) {
    var self = this;

    self.mobile = jQuery(window).width() <= BaT_Theme.screenWidthBreakpoint;

    self.toolbarVM = toolbarVM;

    self.itemsVisible = 'completed';

    self.items = ko.observableArray();

    self.itemsFilteredNumber = ko.observable(0);
    self.pageCurrent = ko.observable(0);
    self.pagesTotal = ko.observable(0);
    self.itemsPerPage = 36;
    self.keywordPages = [];
    self.filtersApplied = ko.observable(false);

    self.showDistances = ko.observable(false);

    self.toolbarVM.toolbarInteractionComplete.subscribe(function () {
        if (self.filtersApplied() || self.items().length === 0) {
            self.loadFirstPage();
        }
    });

    // check once if filters applied changed to update filtersApplied value
    const filtersChangedSubscription = self.toolbarVM.filtersApplied.subscribe(function(filtersApplied) {
        if (self.filtersApplied() !== filtersApplied) {
            self.filtersApplied(true);
        }

        filtersChangedSubscription.dispose();
    });

    const sortChangedSubscription = self.toolbarVM.sortBy.subscribe(function(sortValue) {
        if (self.toolbarVM.sortByDefault !== sortValue) {
            self.filtersApplied(true);
        }

        sortChangedSubscription.dispose();
    });

    self.currentTimestamp = ko.observable();

    self.itemsLoading =  ko.observable(false);
    self.statsLoading =  ko.observable(false);

    self.moreListingsAvailable = ko.pureComputed(function () {
        return self.pageCurrent() < self.pagesTotal();
    });

    self.loadFirstPage = function () {
        self.loadItemsPage(1);
    }

    self.loadNextPage = function () {
        self.loadItemsPage(self.pageCurrent() + 1);
    }

    self.loadItemsPage = function (page) {
        if (self.itemsLoading()) {
            return;
        }

        self.itemsLoading(true);
        self.toolbarVM.itemsLoading(true);

        var fitersSelected = ko.utils.unwrapObservable(self.toolbarVM.fitersSelected());

        Object.keys(fitersSelected).forEach(key => {
            if (typeof fitersSelected[key] == 'boolean') {
                if (fitersSelected[key]) {
                    fitersSelected[key] = 'yes';
                } else {
                    delete fitersSelected[key];
                }
            } else if(!fitersSelected[key] || (Array.isArray(fitersSelected[key]) && 0 === fitersSelected[key].length)) {
                delete fitersSelected[key];
            }
        });

        var postData = {
            page: page,
            per_page: self.itemsPerPage,
            get_items: 1,
            get_stats: 0,
        };
        
        const params = Object.assign(postData, fitersSelected);
        const urlParams = jQuery.param(params);
        const authRequired = self.toolbarVM.isAuthRequiredForFilters();
        
        var options = {
            method: 'GET',
            credentials: authRequired ? 'same-origin' : 'omit',
        }

        if (authRequired) {
            options.headers = { 'X-WP-Nonce': BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.restNonce }
        }

        fetch(`${BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.restUrlListingsFilter}?${urlParams.toString()}`, options)
        .then(res => {
            return res.json().then(data => res.ok ? data : Promise.reject(new Error([res.statusText, data?.message].filter(i => i).join(', '))));
        })
        .then(function( data ) {
            self.itemsPerPage = data.items_per_page;
            self.itemsFilteredNumber(data.items_total);
            self.pageCurrent(data.page_current);
            self.pagesTotal(data.pages_total);

            self.toolbarVM.itemsFilteredNumber(data.items_total);

            if (1 === page) {
                self.items.removeAll();
            };

            self.addItemsBulk(data.items);

            if (1 === page && self.toolbarVM.statsEnabled()) {
                if (data.stats) {
                    self.toolbarVM.updateStatsChart(data.stats);
                } else {
                    if (0 < data.items_total) {
                        self.loadStats();
                    } else {
                        self.toolbarVM.updateStatsChart(null);
                    }
                }
            }
        })
        .catch(function(error) {
            console.log(error);
        })
        .finally(function() {
            self.itemsLoading(false);
            self.toolbarVM.itemsLoading(false);
        });
    }

    self.loadStats = function () {
        if (self.statsLoading()) {
            return;
        }

        self.statsLoading(true);
        self.toolbarVM.statsLoading(true);

        var fitersSelected = ko.utils.unwrapObservable(self.toolbarVM.fitersSelected());

        Object.keys(fitersSelected).forEach(key => {
            if ('boolean' === typeof fitersSelected[key]) {
                if (fitersSelected[key]) {
                    fitersSelected[key] = 'yes';
                } else {
                    delete fitersSelected[key];
                }
            } else if(!fitersSelected[key] || (Array.isArray(fitersSelected[key]) && 0 === fitersSelected[key].length)) {
                delete fitersSelected[key];
            }
        });

        var postData = {
            page: 1,
            per_page: self.itemsPerPage,
            get_items: 0,
            get_stats: 1,
        };

        const params = Object.assign(postData, fitersSelected);
        const urlParams = jQuery.param(params);
        const authRequired = self.toolbarVM.isAuthRequiredForFilters();
        
        var options = {
            method: 'GET',
            credentials: authRequired ? 'same-origin' : 'omit',
        }

        if (authRequired) {
            options.headers = { 'X-WP-Nonce': BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.restNonce }
        }

        fetch(`${BAT_MODEL_LISTINGS_COMPLETED_TOOLBAR.restUrlListingsFilter}?${urlParams.toString()}`, options)
        .then(res => {
            return res.json().then(data => res.ok ? data : Promise.reject(new Error([res.statusText, data?.message].filter(i => i).join(', '))));
        })
        .then(function( data ) {
            if (self.toolbarVM.statsEnabled() && data.stats) {
                self.toolbarVM.updateStatsChart(data.stats);
            }
        })
        .catch(function(error) {
            console.log(error);
        })
        .finally(function() {
            self.statsLoading(false);
            self.toolbarVM.statsLoading(false);
        });
    }

    self.itemsToDisplay = ko.pureComputed(function () {
        return self.items();
    });

    self.addItem = function (item) {
        item.showLive = false;
        item.showStats = false;

        self.items.push(item);
    }

    self.addItemsBulk = function (itemsToAdd) {
        if ('undefined' === typeof itemsToAdd) {
            return;
        }

        for (var i = 0; i < Math.min(itemsToAdd.length, self.itemsPerPage); i ++) {
            self.addItem(new ListingCardViewModel(itemsToAdd[i], self));
        }
    }

    self.getItemById = function (itemId) {
        return ko.utils.arrayFirst(self.items(), function (item) {
            return item.id === itemId;
        });
    };

    self.loadInitialData = function (data) {
        if ('undefined' === typeof data) {
            return;
        }

        self.itemsPerPage = data.items_per_page;

        if ('undefined' !== typeof data.items_per_page_mobile && self.mobile) {
            self.itemsPerPage = data.items_per_page_mobile;
        }

        self.itemsFilteredNumber(data.items_total);
        self.pageCurrent(data.page_current);
        self.pagesTotal(data.pages_total);

        self.toolbarVM.itemsFilteredNumber(data.items_total);
        self.toolbarVM.itemsTotalNumber(data.items_total);

        self.addItemsBulk(data.items);

        if (data.stats_enabled) {
            if (data.stats) {
                self.toolbarVM.updateStatsChart(data.stats);
            } else {
                self.loadStats();
            }
        }
    }

    self.loadInitialData(initialData);

    setInterval(function () {
        self.currentTimestamp(Math.floor((new Date()).getTime() / 1000));
    }, 1000);

};
;
var SearchSortbyFilterModel = function () {

    var self = this;

    // Sort By Dropdown Logic - Dropdown Only
    self.sortingOptions = ko.observableArray();

    self.userLocation = ko.observable();

    self.userLocation.subscribe(function () {
        var options = [
            {key: 'timestamp|desc', caption: BAT_MODEL_LISTINGS_TOOLBAR.textSortByEndingDESC},
            {key: 'timestamp|asc',  caption: BAT_MODEL_LISTINGS_TOOLBAR.textSortByEndingASC},
            {key: 'price|asc',      caption: BAT_MODEL_LISTINGS_TOOLBAR.textSortByBidASC},
            {key: 'price|desc',     caption: BAT_MODEL_LISTINGS_TOOLBAR.textSortByBidDESC}
        ];

        if (false === self.userLocation()) {
            options.push({key: 'location-set', caption: BAT_MODEL_LISTINGS_TOOLBAR.textSortByDistanceUndefined});
        } else {
            //phpcs:disable WordPressVIPMinimum.JS.StringConcat.Found
            options.push({key: 'location', caption: BAT_MODEL_LISTINGS_TOOLBAR.textSortByDistanceDefined + ' <b>' + self.userLocation().zipCode + '</b>'});
            options.push({key: 'location-set', caption: '<b>' + BAT_MODEL_LISTINGS_TOOLBAR.textSortByChangeZIP +'</b>'});
            //phpcs:enable
        }

        self.sortingOptions(options);
    });

    self.userLocation(BaT_Theme.getUserLocation());

    self.sortBy = ko.observable('timestamp|desc');

    self.sortByDisplay = ko.pureComputed(function () {
        var sortBy = self.sortBy();
        var sortByDisplay = '-';

        ko.utils.arrayForEach(self.sortingOptions(), function (item) {
            if (sortBy === item.key) {
                sortByDisplay =  item.caption;
            }
        });

        return sortByDisplay;
    });

    self.setSortBy = function (key) {
        jQuery('.toolbar-dropdown').removeClass('active');

        if ('location-set' === key) {
            BaT_Theme.promptUserLocation(function () {
                var location = BaT_Theme.getUserLocation();

                if (false !== location) {
                    self.userLocation(location);
                    self.sortBy('location');
                }
            }, null);

            return;
        }

        self.sortBy(key);
    }
};
;
var SearchLiveGridModel = function (searchSortByFilterVM) {
    var self = this;

    self.searchSortByFilterVM = searchSortByFilterVM;

    self.items = ko.observableArray();

    self.itemsVisible = 'active';

    self.pusher = 'undefined' !== typeof BAT_WEBSERVICES_PUSHER ? BAT_WEBSERVICES_PUSHER : false;

    self.filteringDisabled = ko.observable(false);

    self.showDistances = ko.pureComputed(function () {
        return 'location' === self.searchSortByFilterVM.sortBy();
    });

    self.searchSortByFilterVM.userLocation.subscribe(function () {
        self.recalculateDistances();
    });

    self.currentTimestamp = ko.observable();

    // we need to recalculate page size when for example interacting with the dropdown and we need
    // to use this function to avoid repeat code but make sure we get an accurate window width reading
    self.getPageSize = function () {
        const widthBreakpoint = 750;
        const desktopPageSize = 18;
        const mobilePageSize = 12;

        return window.innerWidth > widthBreakpoint ? desktopPageSize : mobilePageSize;
    }

    // when this gets updated the sorted array returned from the self.itemsFiltered
    // computed will return the array sliced based on this number.
    self.itemsToDisplayCount = ko.observable(self.getPageSize());

    self.moreItemsAvailable = ko.pureComputed(function() {
        return self.items().length > self.itemsToDisplayCount();
    });

    // calculates the number of items to show on the subsequent page loads
    self.showMoreItems = function () {
        self.itemsToDisplayCount(self.itemsToDisplayCount() + self.getPageSize());
    }

    // every time the dropdown gets interacted with we'll start from page one
    // based on the new filter option
    self.searchSortByFilterVM.sortBy.subscribe(function () {
        self.itemsToDisplayCount(self.getPageSize());
    });

    // runs every time the Sort By dropdown is interacted with
    self.itemsFiltered = ko.pureComputed(function () {

        var items = self.items();

        if (self.filteringDisabled() || 'undefined' === typeof(self.searchSortByFilterVM)) {
            return items;
        }

        return items.sort(function (a, b) { // Sort items
            switch (self.searchSortByFilterVM.sortBy()) {
                case 'price|desc':
                    if (a.initialCurrentBid === b.initialCurrentBid) {
                        return a.initialTimestampEnd > b.initialTimestampEnd ? 1 : -1;
                    }
                    return a.initialCurrentBid < b.initialCurrentBid ? 1 : -1;

                case 'price|asc':
                    if (a.initialCurrentBid === b.initialCurrentBid) {
                        return a.initialTimestampEnd > b.initialTimestampEnd ? 1 : -1;
                    }
                    return a.initialCurrentBid > b.initialCurrentBid ? 1 : -1;

                case 'timestamp|desc':
                    return a.initialTimestampEnd > b.initialTimestampEnd ? 1 : -1;

                case 'timestamp|asc':
                    return a.initialTimestampEnd < b.initialTimestampEnd ? 1 : -1;

                case 'location':
                    if (null !== a.distance() && null !== b.distance() ) {
                        return a.distance() > b.distance() ? 1 : -1;
                    } else if (null === a.distance() && null === b.distance() ) {
                        return 0;
                    } else {
                        return null === a.distance() ? 1 : -1;
                    }

                default:
                    return a.initialTimestampEnd > b.initialTimestampEnd ? 1 : -1;
            }
            // every time this sort function gets called a whole new array of items get returned, we slice() the array with only the amount of items we'd like to show according
            // to our pagination settings defined within this file.
        }).slice(0, self.itemsToDisplayCount());
    });

    self.addItem = function (item) {
        item.showLive = false;
        item.showStats = false;
        item.soldText = false;

        self.items.push(item);

        if (self.pusher) {
            self.pusher.subscribe(item.pusher);
        }
    }

    self.addItemsBulk = function (itemsToAdd) {
        if ('undefined' === typeof(itemsToAdd)) {
            return;
        }

        // make sure that self.items is empty before adding things to it.
        self.items.removeAll();

        self.filteringDisabled(true);
        for (var i = 0; i < itemsToAdd.length; i++) {
            self.addItem(new ListingCardViewModel(itemsToAdd[i], self));
        }
        self.filteringDisabled(false);

        // allow some time before recalculating distances to make sure it's done correctly
        // and when all the items are available.
        setTimeout(function() {
            self.recalculateDistances();
        }, 1000);
    }

    self.getItemById = function (item_id) {
        return ko.utils.arrayFirst(self.items(), function (item) {
            return item.id === item_id;
        });
    };

    self.recalculateDistances = function () {
        // we're disabling filtering so that we can recalculate distances first
        self.filteringDisabled(true);

        var location = self.searchSortByFilterVM.userLocation(),
            userZip = location ? location.zipCode : false,
            userLat = location ? location.lat : false,
            userLon = location ? location.lon : false;

        ko.utils.arrayForEach(self.items(), function (item) {
            var distance = null;

            if (userLat && userLon && item.lat && item.lon) {
                distance = BaT_Theme.distanceBetweenCoordinates(userLat, userLon, item.lat, item.lon);
                item.distanceText(BaT_Theme.formatDistanceInMiles(distance));
                item.distanceFrom(BaT_Theme.closestToZipFromText + ' ' + userZip);
            } else if (0 !== item.country.length) {
                item.distanceText(item.country);
                item.distanceFrom('');
            } else {
                item.distanceText(BaT_Theme.closestToZipNADistanceText);
                item.distanceFrom('');
            }

            item.distance(distance);
        });

        // re-enable filtering after being done recalculating distances.
        self.filteringDisabled(false);
    };

    if (self.pusher) {
        self.pusher.bind(true, 'metadata-updated', function (data) {
            var item = self.getItemById(data.post_id);

            if (item && 'undefined' !== typeof data.listing_card_data) {
                item.currentBid(data.listing_card_data.current_bid);
                item.initialCurrentBid = data.listing_card_data.current_bid;
                item.currentBidFormatted(data.listing_card_data.current_bid_formatted);
                item.currentBidLabel(data.listing_card_data.current_bid_label);
                item.timestampEnd(data.listing_card_data.timestamp_end);
                item.initialTimestampEnd = data.listing_card_data.timestamp_end;
            }
        });
    }

    setInterval(function () {
        self.currentTimestamp(Math.floor((new Date()).getTime() / 1000));
    }, 1000);
};
;
