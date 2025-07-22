import { AgentAction } from "../models/types";


function scrollDirection(direction: 'UP' | 'DOWN', amount: number): void{
    window.scrollBy({
        top: direction === 'UP' ? -amount : amount,
        behavior: 'smooth'
    });
}

function scrollPosition(elementSelector: string | null, scrollPosition: number | null): void {
    if (elementSelector !== null) {
        const element = document.querySelector(elementSelector);
        if (element) {
            element.scrollIntoView({
                behavior: 'smooth'
            });
        }
    } else if (scrollPosition !== null) {
        window.scrollTo({
            top: scrollPosition,
            behavior: 'smooth'
        });
    }
}

function zoom(zoomAmount: number): void {
    document.body.style.zoom = `${zoomAmount}%`;
}

function click_element(elementSelector: string): void {
    const element = document.querySelector(elementSelector) as HTMLElement;
    if (element) {
        element.click();
    } else {
        console.error(`Element with selector ${elementSelector} not found.`);
    }
}

function typeText(text: string, elementSelector: string): void {
    const element = document.querySelector(elementSelector) as HTMLInputElement | HTMLTextAreaElement;
    if (element) {
        element.value = text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
        console.error(`Element with selector ${elementSelector} not found.`);
    }
}

function webSearch(query: string): void {
    if (query) {
        window.open(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, '_blank');
    } else {
        console.error('Search query is empty.');
    }
}

function goToUrl(url: string): void {
    if (url) {
        window.location.href = url;
    } else {
        console.error('URL is empty.');
    }
}

function goBack(tabIndex: number): void {
    window.history.back();
}

function goForward(tabIndex: number): void {
    window.history.forward();
}   

function refreshPage(tabIndex: number): void {
    window.location.reload();
}

export const BrowserActions = {
    scrollDirection,
    scrollPosition,
    zoom,
    click_element,
    typeText,
    webSearch,
    goToUrl,
    goBack,
    goForward,
    refreshPage
};