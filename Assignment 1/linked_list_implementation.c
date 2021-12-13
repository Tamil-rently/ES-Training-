#include<stdio.h>
#include<stdlib.h>
struct node{
    int data;
    struct node* next;

};
struct node *head;
void create(){
    int val;
    struct node *temp;
    temp=(struct node*)malloc(sizeof(struct node));
    printf("enter value: ");
    scanf("%d",&val);
    temp->data=val;
    temp->next=NULL;
    if(head==NULL){
        head=temp;
    }
    else{
        free(head);
        printf("%d\n",head->data);
        head=temp;
    }
}
void display(){
    struct node *p;
    p=head;
    if(head==NULL){
        printf("Empty\n");
    }
    while(p!=NULL){
        printf("%d ",p->data);
        p=p->next;
    }
    printf("\n");
}
void insbeg(){
    int val;
    printf("enter value: ");
    scanf("%d",&val);
    struct node *temp;
    temp=(struct node *)malloc(sizeof(struct node));
    temp->data=val;
    temp->next=NULL;
    if(temp==NULL){
        printf("\n out of memory\n");
        exit(0);
    }
    else{
        temp->next=head;
        head=temp;
    }

}
void insend(){
    struct node *temp,*p;
    int val;
    temp=head;
    p=(struct node*)malloc(sizeof(struct node));
    printf("Enter value: ");
    scanf("%d",&val);
    p->data=val;
    p->next=NULL;
    if(head==NULL){
        head=p;
    }
    else if(head->next==NULL){
        head->next=p;
    }
    else{
    while(temp->next!=NULL){
        temp=temp->next;
    }
    temp->next=p;

    }
}
void inspos(){
    int val,pos,i;
    struct node *temp,*p;
    temp=(struct node*)malloc(sizeof(struct node));
    printf("enter position: ");
    scanf("%d",&pos);
    printf("enter value: ");
    scanf("%d",&val);
    temp->data=val;
    temp->next=NULL;
    if(pos==0){
        temp->next=head;
        head=temp;
    }
    else if(pos<0){
        printf("Enter a psoitive value\n");
    }
    else{
        for(i=0,p=head;i<pos-1;i++){
            p=p->next;
            if(p==NULL){
                printf("Cannot find location\n");
                return;

            }
        }
        temp->next=p->next;
        p->next=temp;

    }
}
void delbeg(){
struct node *temp;
    if(head==NULL){
        printf("no elements found\n");
    }
    else{
        temp=head;
        head=temp->next;
        free(temp);
    }
}

void delend(){
    struct node *p,*temp;
    p=head;
   if(head==NULL){
        printf("no elements found\n");
    } 
    else{
        while(p->next!=NULL){
                temp=p;
                p=p->next;
        }
        temp->next=NULL;
        free(p);

    }

}
void delpos(){
    int pos,i;
   struct node *p,*temp;
    p=head;
    printf("enter a pos to delete: ");
    scanf("%d",&pos);
   if(head==NULL){
        printf("no elements found\n");
    }
    /*else if(pos==0){
       temp=head;
        head=temp->next;
        free(temp);
        
    }*/
    else if(pos<0){
        printf("please enter a positive value\n");
    }
    else{
    for(i=0;i<=pos-1;i++){
        temp=p;
        p=p->next;
        if(p==NULL){
            printf("your position is greater than the list size\n");
            return;
        }
    } 
    if(p!=head){
    temp->next=p->next;
    }
    else{
        head=p->next;
    }
    free(p);
}
}
int main(){
    int ch;
    while(1){
    printf("1)create 2)insbeg 3)insend 4)inspos 5)delbeg 6)delend 7)delpos 8)display 9)exit");
    printf("Enter your choice: ");
    scanf("%d",&ch);
    switch(ch){
        case 1: create(); break;
        case 2: insbeg(); break;
        case 3: insend(); break;
        case 4: inspos(); break;
        case 5: delbeg(); break;
        case 6: delend(); break;
        case 7: delpos(); break;
        case 8: display(); break;
        case 9: exit(0);
    }
    }

}