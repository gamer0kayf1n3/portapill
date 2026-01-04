function createNumberScroller(min, max, initialValue, id) {
    var wrapper = document.createElement('div');
    wrapper.className = 'scroller-container';
    wrapper.id = id;
    
    var highlightBar = document.createElement('div');
    highlightBar.className = 'highlight-bar';

    var scroller = document.createElement('div');
    scroller.className = 'scroller';

    var topPadding = document.createElement('div');
    topPadding.className = 'padding';

    var bottomPadding = document.createElement('div');
    bottomPadding.className = 'padding';

    scroller.appendChild(topPadding);
    scroller.appendChild(bottomPadding);

    wrapper.appendChild(highlightBar);
    wrapper.appendChild(scroller);

    var itemHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--item-height'));
    var selectedValue = initialValue || min;

    for (var i = min; i <= max; i++) {
        var item = document.createElement('div');
        item.className = 'scroller-item';
        item.textContent = String(i).padStart(2, '0');
        item.dataset.value = i;

        item.addEventListener('click', function () {
            scrollToValue(parseInt(this.dataset.value));
        });

        scroller.insertBefore(item, bottomPadding);
    }

    function scrollToValue(value) {
        var items = scroller.querySelectorAll('.scroller-item');
        var index = value - min;
        var scrollTop = index * itemHeight;
        scroller.scrollTo({
            top: scrollTop,
            behavior: 'smooth'
        });
        selectedValue = value;
        updateSelected();
    }

    function updateSelected() {
        var items = scroller.querySelectorAll('.scroller-item');
        var scrollTop = scroller.scrollTop;
        var centerIndex = Math.round(scrollTop / itemHeight);

        items.forEach(function (item, index) {
            if (index === centerIndex) {
                item.classList.add('selected');
                selectedValue = parseInt(item.dataset.value);
            } else {
                item.classList.remove('selected');
            }
        });
    }

    var scrollTimeout;
    scroller.addEventListener('scroll', function () {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(updateSelected, 50);
    });

    setTimeout(function () {
        scrollToValue(initialValue || min);
    }, 100);

    return {
        element: wrapper,
        getValue: function () {
            return selectedValue;
        },
        setValue: function (value) {
            scrollToValue(value);
        }
    };
}

function createSeparator(text) {
    var separator = document.createElement('div');
    separator.className = 'separator';
    separator.textContent = text;
    return separator;
}